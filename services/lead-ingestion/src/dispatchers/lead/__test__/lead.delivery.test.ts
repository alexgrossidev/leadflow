import { describe, it, expect, vi } from "vitest";
import {
  createGatewayLeadDelivery,
  toGatewayLead,
} from "#dispatchers/lead/lead.delivery";
import type { DeliveryGuard } from "#modules/fbLead/leadDelivery.repo";
import {
  LeadFatalError,
  LeadRetryableError,
} from "#modules/fbLead/fbLead.errors";
import { ExternalHttpError } from "#core/http/http.errors";
import type { Lead } from "#modules/fbLead/lead.schema";
import type { LeadDeliveryContext } from "#dispatchers/lead/lead.types";

const lead: Lead = {
  leadId: "lg_1",
  createdTime: new Date("2026-07-02T10:00:00.000Z"),
  fullName: "Mario Rossi",
  email: "mario@example.com",
  phoneNumber: "+39 333 1112223",
  companyName: "Acme Srl",
  message: "Call me",
  customFields: { Budget: "5000" },
};

const ctx: LeadDeliveryContext = {
  userId: 1001,
  businessId: 2001,
  source: "facebook",
};

const silent = {
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
} as never;

function setup(claim: Awaited<ReturnType<DeliveryGuard["claim"]>>) {
  const guard = {
    claim: vi.fn().mockResolvedValue(claim),
    markDelivered: vi.fn().mockResolvedValue(undefined),
    release: vi.fn().mockResolvedValue(undefined),
  };
  const send = vi.fn().mockResolvedValue({ id: 77, created: true });
  const delivery = createGatewayLeadDelivery({ guard, send, logger: silent });
  return { guard, send, delivery };
}

const httpError = (status: number | undefined, code?: string) =>
  new ExternalHttpError("Gateway", "POST /internal/leads", status, code);

describe("gateway lead delivery: claim semantics", () => {
  it("CLAIMED: sends once and marks the claim delivered with the gateway reply", async () => {
    const { guard, send, delivery } = setup("CLAIMED");

    await delivery.deliver(lead, ctx);

    expect(send).toHaveBeenCalledTimes(1);
    expect(guard.markDelivered).toHaveBeenCalledWith(1001, "lg_1", {
      id: 77,
      created: true,
    });
    expect(guard.release).not.toHaveBeenCalled();
  });

  it("ALREADY_DELIVERED: skips the HTTP call entirely", async () => {
    const { send, guard, delivery } = setup("ALREADY_DELIVERED");

    await expect(delivery.deliver(lead, ctx)).resolves.toBeUndefined();

    expect(send).not.toHaveBeenCalled();
    expect(guard.markDelivered).not.toHaveBeenCalled();
  });

  it("IN_PROGRESS: defers with a retryable error and does not send", async () => {
    const { send, guard, delivery } = setup("IN_PROGRESS");

    await expect(delivery.deliver(lead, ctx)).rejects.toBeInstanceOf(
      LeadRetryableError,
    );
    expect(send).not.toHaveBeenCalled();
    expect(guard.release).not.toHaveBeenCalled();
  });

  it("releases the claim when the POST fails, so a retry can re-deliver", async () => {
    const { send, guard, delivery } = setup("CLAIMED");
    send.mockRejectedValueOnce(httpError(503));

    await expect(delivery.deliver(lead, ctx)).rejects.toBeInstanceOf(
      LeadRetryableError,
    );
    expect(guard.release).toHaveBeenCalledWith(1001, "lg_1");
    expect(guard.markDelivered).not.toHaveBeenCalled();
  });

  it("after a successful POST, a failing mark neither releases nor throws", async () => {
    const { guard, delivery } = setup("CLAIMED");
    guard.markDelivered.mockRejectedValueOnce(new Error("db down"));

    await expect(delivery.deliver(lead, ctx)).resolves.toBeUndefined();
    expect(guard.release).not.toHaveBeenCalled();
  });

  it("still surfaces the POST failure when releasing the claim also fails", async () => {
    const { send, guard, delivery } = setup("CLAIMED");
    send.mockRejectedValueOnce(httpError(502));
    guard.release.mockRejectedValueOnce(new Error("db down"));

    await expect(delivery.deliver(lead, ctx)).rejects.toBeInstanceOf(
      LeadRetryableError,
    );
  });

  it.each([
    [500, LeadRetryableError],
    [503, LeadRetryableError],
    [408, LeadRetryableError],
    [429, LeadRetryableError],
    [400, LeadFatalError],
    [401, LeadFatalError],
    [422, LeadFatalError],
  ])("classifies HTTP %i as %o", async (status, expected) => {
    const { send, delivery } = setup("CLAIMED");
    send.mockRejectedValueOnce(httpError(status));
    await expect(delivery.deliver(lead, ctx)).rejects.toBeInstanceOf(expected);
  });

  it("treats a network failure (no response) as retryable", async () => {
    const { send, delivery } = setup("CLAIMED");
    send.mockRejectedValueOnce(httpError(undefined, "ECONNREFUSED"));
    await expect(delivery.deliver(lead, ctx)).rejects.toBeInstanceOf(
      LeadRetryableError,
    );
  });

  it("treats 200 (lead already existed at the gateway) as delivered", async () => {
    const { send, guard, delivery } = setup("CLAIMED");
    send.mockResolvedValueOnce({ id: 77, created: false });

    await delivery.deliver(lead, ctx);

    expect(guard.markDelivered).toHaveBeenCalledWith(1001, "lg_1", {
      id: 77,
      created: false,
    });
  });
});

describe("toGatewayLead", () => {
  it("maps a lead onto the intake contract", () => {
    expect(toGatewayLead(lead, ctx)).toEqual({
      businessId: 2001,
      userId: 1001,
      source: "facebook",
      externalId: "lg_1",
      fullName: "Mario Rossi",
      email: "mario@example.com",
      phone: "+39 333 1112223",
      fields: { company: "Acme Srl", message: "Call me", Budget: "5000" },
      createdAt: "2026-07-02T10:00:00.000Z",
    });
  });

  it("accepts a lead whose date round-tripped through a JSON column", () => {
    const fromDb = JSON.parse(JSON.stringify(lead)) as Lead;
    expect(toGatewayLead(fromDb, ctx).createdAt).toBe("2026-07-02T10:00:00.000Z");
  });

  it("sends explicit nulls for missing contact fields", () => {
    const body = toGatewayLead({ leadId: "x", customFields: {} }, ctx);
    expect(body).toMatchObject({ fullName: null, email: null, phone: null });
  });
});
