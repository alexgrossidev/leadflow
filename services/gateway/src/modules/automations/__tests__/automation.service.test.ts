import { describe, it, expect, vi, beforeEach } from "vitest";
import { eventNames } from "@leadflow/shared/eventBus";
import { AutomationService } from "../automation.service.js";
import type { AutomationRepository } from "../automation.repo.js";
import type { AutomationStepRepository } from "../automation.step.repo.js";
import type { AutomationBody } from "../automation.schema.js";
import { NotFoundError } from "#core/errors/http-errors";

const h = vi.hoisted(() => {
  const order: string[] = [];
  return {
    order,
    tx: { marker: "tx" },
    emitToAutomations: vi.fn(async (event: string) => {
      order.push(`emit:${event}`);
      return "job";
    }),
  };
});

vi.mock("#database/mainPool", () => ({
  mainDb: {
    transaction: vi.fn(async (cb: (tx: unknown) => unknown) => {
      h.order.push("begin");
      const result = await cb(h.tx);
      h.order.push("commit");
      return result;
    }),
  },
}));
vi.mock("#comms/bullmq/bullmq.eventEmitter", () => ({ emitToAutomations: h.emitToAutomations }));

const tenant = { userId: 3, businessId: 7 };
const body: AutomationBody = {
  name: "Welcome",
  steps: [{ title: "Hi", stepType: "whatsapp", content: "Hello" }],
};

describe("AutomationService", () => {
  let repo: Record<string, ReturnType<typeof vi.fn>>;
  let steps: Record<string, ReturnType<typeof vi.fn>>;
  let service: AutomationService;

  beforeEach(() => {
    h.order.length = 0;
    h.emitToAutomations.mockClear();
    repo = {
      insert: vi.fn().mockResolvedValue(42),
      findForUpdate: vi.fn().mockResolvedValue({ id: 42, business_id: 7, name: "Welcome" }),
      update: vi.fn(),
      delete: vi.fn().mockResolvedValue(true),
    };
    steps = { sync: vi.fn().mockResolvedValue([{ id: 1 }]), deleteAll: vi.fn() };
    service = new AutomationService(
      repo as unknown as AutomationRepository,
      steps as unknown as AutomationStepRepository,
    );
  });

  it("creates with tenant ownership, writes steps in the same transaction, emits after commit", async () => {
    await expect(service.create(tenant, body)).resolves.toBe(42);

    expect(repo.insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 3, business_id: 7, name: "Welcome" }),
      h.tx,
    );
    expect(steps.sync).toHaveBeenCalledWith(42, body.steps, h.tx);
    expect(h.order).toEqual(["begin", "commit", `emit:${eventNames.AUTOMATION_CREATED}`]);
  });

  it("includes the automation id in automation.updated", async () => {
    await service.update(tenant, 42, body);

    expect(repo.update).toHaveBeenCalledWith(42, 7, { name: "Welcome" }, h.tx);
    expect(h.emitToAutomations).toHaveBeenCalledWith(eventNames.AUTOMATION_UPDATED, {
      userId: 3,
      automation: expect.objectContaining({ id: 42, steps: [{ id: 1 }] }),
    });
  });

  it("refuses to update another business's automation and emits nothing", async () => {
    repo.findForUpdate!.mockResolvedValue(null);
    await expect(service.update(tenant, 99, body)).rejects.toBeInstanceOf(NotFoundError);
    expect(h.emitToAutomations).not.toHaveBeenCalled();
  });

  it("deletes steps and rule together and emits automation.deleted", async () => {
    await service.delete(tenant, 42);

    expect(steps.deleteAll).toHaveBeenCalledWith(42, h.tx);
    expect(repo.delete).toHaveBeenCalledWith(42, 7, h.tx);
    expect(h.emitToAutomations).toHaveBeenCalledWith(eventNames.AUTOMATION_DELETED, {
      userId: 3,
      businessId: 7,
      automationId: 42,
    });
  });

  it("keeps the committed change when the emit fails (logged, not thrown)", async () => {
    h.emitToAutomations.mockRejectedValueOnce(new Error("redis down"));
    await expect(service.setPaused(tenant, 42, true)).resolves.toBeUndefined();
    expect(repo.update).toHaveBeenCalledWith(42, 7, { paused: true }, h.tx);
  });
});
