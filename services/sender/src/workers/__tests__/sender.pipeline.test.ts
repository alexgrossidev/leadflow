import { beforeEach, describe, expect, it } from "vitest";
import { JobNames, type AutomationExecuteExternalPayload } from "@leadflow/shared/jobs";
import { defaultSettings, SenderSteps } from "#config/constants";
import type { OutgoingEmail } from "#core/email.transport";
import { createEmailInspector } from "#dispatchers/inspector/email/inspector";
import { DEFAULT_OPENING_TIMES } from "#dispatchers/processor/limiter/limiter.types";
import type { DeliveryRecord } from "#modules/deliveries/deliveries.table";
import type { NewSendingError } from "#modules/sendingErrors/sendingErrors.table";
import type { Settings } from "#modules/settings/settings.table";
import { createSenderPipeline, type SenderDeps } from "../sender.pipeline";
import { FakeQueue, toContext, type QueuedJob } from "./fakes";

const TUESDAY_10_ROME = new Date("2026-03-10T09:00:00Z");
const SATURDAY_11_ROME = new Date("2026-03-14T10:00:00Z");
const MONDAY_09_ROME = new Date("2026-03-16T08:00:00Z");

const request = (overrides: Partial<AutomationExecuteExternalPayload> = {}): AutomationExecuteExternalPayload => ({
  automationId: 7,
  userId: 3,
  businessId: 1,
  recipientData: { id: 100, type: "lead", email: " Ada@Leadflow.dev " },
  content: { type: "email", subject: "Welcome", content: "Hello Ada" },
  ...overrides,
});

describe("sender pipeline", () => {
  let now: Date;
  let queue: FakeQueue;
  let settings: Settings;
  let emails: Array<OutgoingEmail & { at: Date }>;
  let whatsapps: Array<{ key: string; at: Date }>;
  let deliveries: DeliveryRecord[];
  let errors: NewSendingError[];
  let deps: SenderDeps;
  let pipeline: ReturnType<typeof createSenderPipeline>;
  let processed: QueuedJob[];

  beforeEach(() => {
    now = TUESDAY_10_ROME;
    queue = new FakeQueue(() => now);
    settings = { ...defaultSettings, businessId: 1, validateForBusinessHours: true, minimumWaitBetweenMessages: 60 };
    emails = [];
    whatsapps = [];
    deliveries = [];
    errors = [];
    processed = [];

    deps = {
      queue,
      clock: () => now,
      rng: () => 0,
      settings: { getForBusiness: async () => settings },
      openingTimes: { getWeek: async () => DEFAULT_OPENING_TIMES },
      multiseat: { isEnabled: async () => false },
      usage: {
        get: async (userId, day) => {
          const mine = deliveries.filter((d) => d.userId === userId && d.day === day);
          return {
            emailsSent: mine.filter((d) => d.channel === "email").length,
            whatsappSent: mine.filter((d) => d.channel === "whatsapp").length,
          };
        },
        lastSentAt: async (userId) =>
          deliveries.filter((d) => d.userId === userId).at(-1)?.sentAt ?? null,
      },
      deliveries: {
        isDelivered: async (key) => deliveries.some((d) => d.messageKey === key),
        record: async (d) => void deliveries.push(d),
      },
      errors: { record: async (e) => void errors.push(e) },
      email: { send: async (email) => void emails.push({ ...email, at: now }) },
      whatsapp: { publish: async (p) => void whatsapps.push({ key: p.idempotencyKey, at: now }) },
      inspector: createEmailInspector("basic", {
        resolveMx: () => Promise.reject(new Error("no network in tests")),
        resolveTxt: () => Promise.reject(new Error("no network in tests")),
      }),
    };
    pipeline = createSenderPipeline(deps);
  });

  /** Runs jobs in due order on the virtual clock until the queue is empty. */
  async function drain() {
    for (let guard = 0; guard < 200; guard++) {
      const job = queue.next();
      if (!job) return;
      now = new Date(Math.max(now.getTime(), job.dueAt));
      processed.push(job);
      if (job.queue === JobNames.AUTOMATION_EXECUTE_EXTERNAL) await pipeline.handleRequest(toContext(job));
      else await pipeline.handleStage(toContext(job));
    }
    throw new Error("pipeline did not settle");
  }

  const stagesRun = () =>
    processed.filter((j) => j.queue === JobNames.SENDER_PROCESS).map((j) => j.name.split(":")[1]);

  it("takes a message through every stage and delivers it exactly once", async () => {
    await queue.enqueue(JobNames.AUTOMATION_EXECUTE_EXTERNAL, request());
    await drain();

    expect(stagesRun()).toEqual([
      SenderSteps.CLEAN_DATA,
      SenderSteps.CALCULATE_LIMITS,
      SenderSteps.CALCULATE_DEAD_TIME,
      SenderSteps.DELIVER,
    ]);
    const stageIds = processed.filter((j) => j.queue === JobNames.SENDER_PROCESS).map((j) => j.id);
    expect(new Set(stageIds).size).toBe(4);

    expect(emails).toHaveLength(1);
    expect(emails[0]).toMatchObject({ to: "Ada@leadflow.dev", subject: "Welcome", text: "Hello Ada" });
    expect(deliveries).toEqual([expect.objectContaining({ channel: "email", userId: 3, day: "2026-03-10" })]);
    expect(errors).toEqual([]);
  });

  it("does not deliver twice when the same request arrives again", async () => {
    await queue.enqueue(JobNames.AUTOMATION_EXECUTE_EXTERNAL, request());
    await queue.enqueue(JobNames.AUTOMATION_EXECUTE_EXTERNAL, request());
    await drain();

    expect(emails).toHaveLength(1);
    expect(queue.ignored.some((id) => id.includes(SenderSteps.CLEAN_DATA))).toBe(true);
  });

  it("does not deliver twice when a DELIVER job is replayed", async () => {
    await queue.enqueue(JobNames.AUTOMATION_EXECUTE_EXTERNAL, request());
    await drain();
    const deliver = processed.find((j) => j.name.endsWith(SenderSteps.DELIVER));
    if (!deliver) throw new Error("no DELIVER job");

    await pipeline.handleStage(toContext(deliver, 1));
    expect(emails).toHaveLength(1);
  });

  it("outside opening hours, delays to the next opening and then delivers", async () => {
    now = SATURDAY_11_ROME;
    await queue.enqueue(JobNames.AUTOMATION_EXECUTE_EXTERNAL, request());
    await drain();

    const limits = processed.filter((j) => j.name.endsWith(SenderSteps.CALCULATE_LIMITS));
    expect(limits).toHaveLength(2);
    expect(limits[0]?.id).not.toBe(limits[1]?.id);
    expect(limits[1]?.opts.delay).toBe(MONDAY_09_ROME.getTime() - SATURDAY_11_ROME.getTime());
    expect(emails.map((e) => e.at)).toEqual([MONDAY_09_ROME]);
  });

  it("paces consecutive messages from the same user", async () => {
    await queue.enqueue(JobNames.AUTOMATION_EXECUTE_EXTERNAL, request());
    await queue.enqueue(
      JobNames.AUTOMATION_EXECUTE_EXTERNAL,
      request({ content: { type: "whatsapp", content: "Ciao" }, recipientData: { id: 101, type: "lead", phone: "333 555 1234" } }),
    );
    await drain();

    expect(emails).toHaveLength(1);
    expect(whatsapps).toHaveLength(1);
    const [first, second] = [emails[0]!.at, whatsapps[0]!.at].sort((a, b) => a.getTime() - b.getTime());
    expect(second!.getTime() - first!.getTime()).toBeGreaterThanOrEqual(60_000 + 2_000);
    expect(deliveries.map((d) => d.channel).sort()).toEqual(["email", "whatsapp"]);
  });

  it("holds messages once the daily cap is reached, until the next day opens", async () => {
    settings = { ...settings, maxEmails: 1, toleranceRate: 0, minimumWaitBetweenMessages: 0 };
    await queue.enqueue(JobNames.AUTOMATION_EXECUTE_EXTERNAL, request());
    await queue.enqueue(JobNames.AUTOMATION_EXECUTE_EXTERNAL, request({ recipientData: { id: 101, type: "lead", email: "bob@leadflow.dev" } }));
    await drain();

    expect(emails.map((e) => e.at.toISOString())).toEqual([
      TUESDAY_10_ROME.toISOString(),
      "2026-03-11T08:00:00.000Z", // Wednesday 09:00 in Rome
    ]);
  });

  it("records refused messages instead of dropping them silently", async () => {
    await queue.enqueue(JobNames.AUTOMATION_EXECUTE_EXTERNAL, request({ recipientData: { id: 1, type: "lead", email: "not an email" } }));
    await queue.enqueue(JobNames.AUTOMATION_EXECUTE_EXTERNAL, request({ recipientData: { id: 2, type: "lead", email: "x@mailinator.com" } }));
    await queue.enqueue(JobNames.AUTOMATION_EXECUTE_EXTERNAL, request({ content: { type: "email", content: "no subject" } }));
    await drain();

    expect(emails).toHaveLength(0);
    expect(errors.map((e) => [e.recipientId, e.stage])).toEqual([
      [100, "VALIDATE_REQUEST"],
      [1, SenderSteps.CLEAN_DATA],
      [2, SenderSteps.CLEAN_DATA],
    ]);
  });

  it("fails a malformed payload without retries", async () => {
    await expect(
      pipeline.handleRequest({ id: "1", name: JobNames.AUTOMATION_EXECUTE_EXTERNAL, attemptsMade: 0, data: { automationId: "7" } as never }),
    ).rejects.toMatchObject({ name: "UnrecoverableError" });
  });

  it("retries a failed send, and records it once the last attempt fails", async () => {
    pipeline = createSenderPipeline({
      ...deps,
      email: { send: () => Promise.reject(new Error("SMTP 421 try again later")) },
    });
    await queue.enqueue(JobNames.AUTOMATION_EXECUTE_EXTERNAL, request());
    let deliver: QueuedJob | undefined;
    for (let job = queue.next(); job; job = queue.next()) {
      if (job.name.endsWith(SenderSteps.DELIVER)) deliver = job;
      else if (job.queue === JobNames.AUTOMATION_EXECUTE_EXTERNAL) await pipeline.handleRequest(toContext(job));
      else await pipeline.handleStage(toContext(job));
    }
    if (!deliver) throw new Error("no DELIVER job");

    await expect(pipeline.handleStage(toContext(deliver, 0))).rejects.toThrow(/SMTP/);
    expect(errors).toHaveLength(0);
    await expect(pipeline.handleStage(toContext(deliver, 2))).rejects.toThrow(/SMTP/);
    expect(errors).toEqual([expect.objectContaining({ stage: SenderSteps.DELIVER, recipientId: 100 })]);
    expect(deliveries).toHaveLength(0);
  });
});
