import { beforeEach, describe, expect, it } from "vitest";
import { JobNames } from "@leadflow/shared/jobs";
import { createExecutionHandler, type ExecutionDeps } from "../automation.process";
import { ctx, FakeQueue } from "../../__tests__/fakeQueue";
import type { AutomationRow } from "../../modules/automations/automation.table";
import type { AutomationStep } from "../../modules/automations/automation.step.table";
import type { Target } from "../../modules/automationTargets/target.table";

const T0 = new Date("2026-03-10T09:00:00.000Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

const automation: AutomationRow = {
  id: 7,
  user_id: 3,
  business_id: 42,
  name: "Welcome",
  automationType: "lead",
  paused: false,
  pausedAt: null,
  field: null,
  operator: null,
  value: null,
  scheduledDeletionAt: null,
  created_at: T0,
};

const step = (id: number, sequence: number, delay: number, stepType: "email" | "whatsapp"): AutomationStep => ({
  id,
  automation_id: 7,
  title: null,
  description: null,
  stepType,
  subject: stepType === "email" ? `Subject ${sequence}` : null,
  content: `Body ${sequence}`,
  attachments: null,
  delay,
  delay_unit: "hour",
  step_sequence: sequence,
  created_at: T0,
  updated_at: T0,
});

describe("automation execution", () => {
  let queue: FakeQueue;
  let now: Date;
  let target: Target;
  let deps: ExecutionDeps;
  let current: AutomationRow;

  beforeEach(() => {
    queue = new FakeQueue();
    now = T0;
    current = { ...automation };
    target = {
      automationId: 7,
      type: "lead",
      originalId: 100,
      userId: 3,
      businessId: 42,
      step: null,
      stepId: null,
      paused: false,
      pausedTime: null,
      enrolledAt: T0,
      lastExecutionTime: null,
      expectedExecutionTime: null,
    };
    deps = {
      automations: {
        getById: async () => current,
        getSteps: async () => [step(10, 1, 0, "email"), step(11, 2, 2, "whatsapp"), step(12, 3, 1, "email")],
      },
      targets: {
        get: async () => ({ ...target }),
        markPaused: async (_key, pausedAt) => {
          target = { ...target, paused: true, pausedTime: pausedAt };
        },
        updateSchedule: async (_key, update) => {
          target = { ...target, ...update };
        },
      },
      contacts: {
        get: async (originalId, type, businessId) => ({
          originalId,
          type,
          businessId,
          userId: 3,
          email: "ada@leadflow.test",
          phone: "+393331234567",
        }),
      },
      queue,
      clock: () => now,
    };
  });

  const runPending = async () => {
    const handler = createExecutionHandler(deps);
    for (const job of queue.drain(JobNames.AUTOMATION_EXECUTE_INTERNAL)) {
      now = new Date(now.getTime() + (job.opts.delay ?? 0));
      await handler(ctx(job));
    }
  };

  it("walks a lead through every step, each handed to the sender exactly once", async () => {
    await queue.enqueue(JobNames.AUTOMATION_EXECUTE_INTERNAL, {
      automationId: 7, userId: 3, leadId: 100, type: "lead", executionType: "launch",
    });
    for (let i = 0; i < 10; i++) await runPending();

    const deliveries = queue.of(JobNames.AUTOMATION_EXECUTE_EXTERNAL);
    expect(deliveries.map((j) => j.data.content.type)).toEqual(["email", "whatsapp", "email"]);
    expect(deliveries.map((j) => j.data.businessId)).toEqual([42, 42, 42]);
    expect(deliveries[0]?.data.recipientData).toMatchObject({ id: 100, type: "lead", email: "ada@leadflow.test" });
    expect(new Set(deliveries.map((j) => j.id)).size).toBe(3);

    // Step 2 waits 2h after step 1; step 3 waits 1h after step 2.
    expect(target.lastExecutionTime).toEqual(at(180));
    expect(target.step).toBe(4);
    expect(target.stepId).toBeNull();
  });

  it("does not hand a step off twice when the same run is replayed", async () => {
    const handler = createExecutionHandler(deps);
    const job = { id: "x", name: JobNames.AUTOMATION_EXECUTE_INTERNAL, attemptsMade: 0,
      data: { automationId: 7, userId: 3, leadId: 100, type: "lead" as const, executionType: "launch" as const } };
    const before = { ...target };
    await handler(job);
    target = before; // simulate a crash before the target update committed
    await handler(job);

    expect(queue.of(JobNames.AUTOMATION_EXECUTE_EXTERNAL)).toHaveLength(1);
    expect(queue.ignored.some((id) => id.startsWith("deliver_"))).toBe(true);
  });

  it("re-enqueues itself for the due time instead of sending early", async () => {
    target = { ...target, step: 2, stepId: 11, lastExecutionTime: T0, expectedExecutionTime: at(120) };
    await createExecutionHandler(deps)(ctx(await enqueueLaunch()));

    expect(queue.of(JobNames.AUTOMATION_EXECUTE_EXTERNAL)).toHaveLength(0);
    const [rescheduled] = queue.of(JobNames.AUTOMATION_EXECUTE_INTERNAL).slice(1);
    expect(rescheduled?.opts.delay).toBe(120 * 60_000);
  });

  it("stands down and flags the target when the automation is paused", async () => {
    current = { ...automation, paused: true, pausedAt: T0 };
    await createExecutionHandler(deps)(ctx(await enqueueLaunch()));

    expect(target.paused).toBe(true);
    expect(queue.of(JobNames.AUTOMATION_EXECUTE_EXTERNAL)).toHaveLength(0);
  });

  it("drops runs for an automation scheduled for deletion", async () => {
    current = { ...automation, scheduledDeletionAt: T0 };
    await createExecutionHandler(deps)(ctx(await enqueueLaunch()));
    expect(queue.of(JobNames.AUTOMATION_EXECUTE_EXTERNAL)).toHaveLength(0);
  });

  async function enqueueLaunch() {
    await queue.enqueue(JobNames.AUTOMATION_EXECUTE_INTERNAL, {
      automationId: 7, userId: 3, leadId: 100, type: "lead", executionType: "launch",
    });
    const [job] = queue.drain(JobNames.AUTOMATION_EXECUTE_INTERNAL);
    if (!job) throw new Error("no job");
    return job;
  }
});
