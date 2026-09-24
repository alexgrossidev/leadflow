import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { eventNames } from "@leadflow/shared/eventBus";

const SERVICE_TOKEN = process.env.SERVICE_TOKEN!;

interface StoredLead {
  id: number;
  businessId: number;
  userId: number;
  source: string;
  externalId: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  customFields: Record<string, string>;
  eventEmittedAt: Date | null;
  created_at: Date;
}

const state = vi.hoisted(() => ({
  leads: [] as StoredLead[],
  emit: vi.fn(),
}));

// In-memory stand-in for the leads table, including its unique key.
vi.mock("../modules/lead/lead.repo.js", () => ({
  LeadRepository: class {
    async businessBelongsToUser(businessId: number, userId: number) {
      return businessId === 7 && userId === 3;
    }
    async insert(data: Omit<StoredLead, "id" | "eventEmittedAt" | "created_at"> & { created_at?: Date }) {
      const clash = state.leads.some(
        (l) =>
          l.businessId === data.businessId &&
          l.source === data.source &&
          l.externalId === data.externalId,
      );
      if (clash) {
        throw Object.assign(new Error("Failed query"), {
          cause: Object.assign(new Error("Duplicate entry"), { code: "ER_DUP_ENTRY" }),
        });
      }
      const id = state.leads.length + 1;
      state.leads.push({ ...data, id, eventEmittedAt: null, created_at: data.created_at ?? new Date() });
      return id;
    }
    async findById(id: number) {
      return state.leads.find((l) => l.id === id) ?? null;
    }
    async findByExternalId(businessId: number, source: string, externalId: string) {
      return (
        state.leads.find(
          (l) => l.businessId === businessId && l.source === source && l.externalId === externalId,
        ) ?? null
      );
    }
    async markEventEmitted(id: number) {
      const lead = state.leads.find((l) => l.id === id);
      if (lead) lead.eventEmittedAt = new Date();
    }
  },
}));

vi.mock("#comms/bullmq/bullmq.eventEmitter", () => ({
  emitToAutomations: state.emit,
  emitToSender: vi.fn(),
  emitToWhatsapp: vi.fn(),
}));

const { createApp } = await import("../app.js");

const validLead = {
  businessId: 7,
  userId: 3,
  source: "facebook",
  externalId: "fb-123",
  fullName: "Ada Lovelace",
  email: "ada@example.com",
  phone: "+447700900123",
  fields: { budget: "1500" },
  createdAt: "2026-09-01T10:00:00.000Z",
};

describe("POST /internal/leads", () => {
  const app = createApp();
  const post = (body: unknown, token: string | null = SERVICE_TOKEN) => {
    const req = request(app).post("/internal/leads");
    if (token !== null) req.set("x-service-token", token);
    return req.send(body as object);
  };

  beforeEach(() => {
    state.leads.length = 0;
    state.emit.mockReset();
    state.emit.mockResolvedValue("job-id");
  });

  it("returns 401 without a service token or with a wrong one", async () => {
    expect((await post(validLead, null)).status).toBe(401);
    expect((await post(validLead, "not-the-token")).status).toBe(401);
    expect(state.leads).toHaveLength(0);
  });

  it("returns 400 on an invalid body", async () => {
    const res = await post({ ...validLead, source: "carrier-pigeon", email: "nope" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("returns 422 for a business that does not belong to the user", async () => {
    expect((await post({ ...validLead, businessId: 8 })).status).toBe(422);
  });

  it("creates with 201, answers a duplicate with 200 and announces the lead once", async () => {
    const first = await post(validLead);
    expect(first.status).toBe(201);
    expect(first.body).toEqual({ id: 1, created: true });

    const second = await post(validLead);
    expect(second.status).toBe(200);
    expect(second.body).toEqual({ id: 1, created: false });

    expect(state.leads).toHaveLength(1);
    expect(state.emit).toHaveBeenCalledTimes(1);
    expect(state.emit).toHaveBeenCalledWith(
      eventNames.LEAD_CREATED,
      {
        leadId: 1,
        businessId: 7,
        userId: 3,
        source: "facebook",
        fullName: "Ada Lovelace",
        email: "ada@example.com",
        phone: "+447700900123",
        fields: { budget: "1500" },
        createdAt: "2026-09-01T10:00:00.000Z",
      },
      { jobId: "lead.created:1" },
    );
  });

  it("answers 503 when the event cannot be published, and publishes on the retry", async () => {
    state.emit.mockRejectedValueOnce(new Error("redis down"));

    const first = await post(validLead);
    expect(first.status).toBe(503);
    expect(state.leads).toHaveLength(1);

    const retry = await post(validLead);
    expect(retry.status).toBe(200);
    expect(retry.body).toEqual({ id: 1, created: false });
    expect(state.emit).toHaveBeenCalledTimes(2);
    expect(state.leads[0]!.eventEmittedAt).not.toBeNull();
  });
});
