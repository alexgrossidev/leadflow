import { describe, expect, it, vi } from "vitest";
import { BullMQEventBus } from "../eventBus/bullmq.eventBus";
import { eventNames, serviceNames } from "../eventBus/event.types";
import type { JobContext, JobHandler, QueueProvider } from "../queue";

/** Captures what the bus asks the provider to do, and lets the test deliver jobs. */
function fakeProvider() {
  const processors = new Map<string, JobHandler<unknown>>();
  const provider = {
    enqueue: vi.fn(async () => "job-1"),
    bulkEnqueue: vi.fn(),
    schedule: vi.fn(),
    unschedule: vi.fn(),
    scheduleOnce: vi.fn(),
    close: vi.fn(),
    process: vi.fn((queue: string, handler: JobHandler<unknown>) => {
      processors.set(queue, handler);
      return { close: vi.fn(async () => {}) };
    }),
  } satisfies QueueProvider;
  const deliver = (queue: string, job: Partial<JobContext<unknown>>) =>
    processors.get(queue)!({ id: "1", attemptsMade: 0, data: {}, name: "", ...job });
  return { provider, deliver };
}

const payload = {
  leadId: 7, businessId: 1, userId: 2, source: "manual" as const,
  fullName: "Ada", email: null, phone: null, fields: {}, createdAt: "2026-01-01T00:00:00Z",
};

describe("BullMQEventBus", () => {
  it("routes an event to the consuming service's queue with the event as job name", async () => {
    const { provider } = fakeProvider();
    await new BullMQEventBus(provider).emit(serviceNames.AUTOMATIONS, eventNames.LEAD_CREATED, payload, { jobId: "lead:7" });
    expect(provider.enqueue).toHaveBeenCalledWith(
      "automations",
      payload,
      expect.objectContaining({ customJobName: "lead.created", jobId: "lead:7" }),
    );
  });

  it("uses one worker per service and dispatches by event name", async () => {
    const { provider, deliver } = fakeProvider();
    const bus = new BullMQEventBus(provider);
    const onLead = vi.fn(async () => {});
    const onPause = vi.fn(async () => {});
    bus.subscribe(serviceNames.AUTOMATIONS, eventNames.LEAD_CREATED, onLead);
    bus.subscribe(serviceNames.AUTOMATIONS, eventNames.AUTOMATION_PAUSED, onPause);
    expect(provider.process).toHaveBeenCalledTimes(1);

    await deliver("automations", { name: "automations:lead.created", data: payload });
    expect(onLead).toHaveBeenCalledWith(payload, expect.objectContaining({ eventName: "lead.created" }));
    expect(onPause).not.toHaveBeenCalled();
  });

  it("rethrows handler errors so the queue retries the event", async () => {
    const { provider, deliver } = fakeProvider();
    const bus = new BullMQEventBus(provider);
    bus.subscribe(serviceNames.AUTOMATIONS, eventNames.LEAD_CREATED, async () => { throw new Error("db down"); });
    await expect(deliver("automations", { name: "automations:lead.created" })).rejects.toThrow("db down");
  });

  it("acknowledges events nobody handles instead of failing them forever", async () => {
    const { provider, deliver } = fakeProvider();
    const bus = new BullMQEventBus(provider);
    bus.subscribe(serviceNames.AUTOMATIONS, eventNames.LEAD_CREATED, async () => {});
    await expect(deliver("automations", { name: "automations:automation.deleted" })).resolves.toBeUndefined();
  });
});
