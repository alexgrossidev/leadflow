import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { LeadService, type LeadEventEmitter } from "../lead.service.js";
import type { LeadRepository } from "../lead.repo.js";
import { NotFoundError } from "#core/errors/http-errors";

vi.mock("#comms/bullmq/bullmq.eventEmitter", () => ({ emitToAutomations: vi.fn() }));

const tenant = { userId: 3, businessId: 7 };

describe("LeadService (manual leads)", () => {
  let repo: {
    insert: ReturnType<typeof vi.fn>;
    findById: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    markEventEmitted: ReturnType<typeof vi.fn>;
  };
  let emit: Mock<LeadEventEmitter>;
  let service: LeadService;

  beforeEach(() => {
    repo = {
      insert: vi.fn().mockResolvedValue(11),
      findById: vi.fn(),
      update: vi.fn(),
      markEventEmitted: vi.fn(),
    };
    emit = vi.fn<LeadEventEmitter>().mockResolvedValue("job");
    service = new LeadService(repo as unknown as LeadRepository, emit);
  });

  it("creates the lead in the tenant's business and announces it", async () => {
    repo.findById.mockResolvedValue({
      id: 11,
      businessId: 7,
      userId: 3,
      source: "manual",
      name: "Ada",
      email: null,
      phone: null,
      customFields: {},
      created_at: new Date("2026-01-01T00:00:00Z"),
    });

    await expect(service.create(tenant, { name: "Ada" })).resolves.toEqual({ id: 11 });
    expect(repo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ businessId: 7, userId: 3, source: "manual", name: "Ada" }),
    );
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ leadId: 11, businessId: 7, source: "manual" }),
      "lead.created:11",
    );
    expect(repo.markEventEmitted).toHaveBeenCalledWith(11);
  });

  it("keeps the lead but leaves it flagged when the announcement fails", async () => {
    repo.findById.mockResolvedValue({ id: 11, businessId: 7, userId: 3, created_at: new Date() });
    emit.mockRejectedValue(new Error("redis down"));

    await expect(service.create(tenant, { name: "Ada" })).resolves.toEqual({ id: 11 });
    expect(repo.markEventEmitted).not.toHaveBeenCalled();
  });

  it("scopes updates by business and reports a miss as 404", async () => {
    repo.update.mockResolvedValue(false);
    await expect(service.update(tenant, 99, { status: "won" })).rejects.toBeInstanceOf(
      NotFoundError,
    );
    expect(repo.update).toHaveBeenCalledWith(99, 7, { status: "won" });
  });
});
