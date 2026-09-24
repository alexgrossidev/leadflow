import { logger, type JobContext } from "@leadflow/shared";
import { JobNames, type AutomationExecuteExternalPayload, type SenderProcessPayload } from "@leadflow/shared/jobs";
import {
  DEFAULT_RETRY_DELAY_MS,
  MAX_RESCHEDULES,
  SenderSteps,
  STAGE_ATTEMPTS,
} from "#config/constants";
import { UnrecoverableJobError } from "#core/errors";
import type { Enqueuer } from "#core/queue";
import type { EmailInspector } from "#dispatchers/inspector/email/inspector";
import { SENDER_CLEAN_DATA } from "#dispatchers/processor/sender.CLEAN";
import { SENDER_DEADTIME } from "#dispatchers/processor/sender.DEADTIME";
import { SENDER_DELIVER, type DeliverDeps } from "#dispatchers/processor/sender.DELIVER";
import { SENDER_LIMITS } from "#dispatchers/processor/sender.LIMITS";
import type { StageResult } from "#dispatchers/processor/types";
import type { NewSendingError } from "#modules/sendingErrors/sendingErrors.table";
import {
  messageKey,
  validateBusinessRules,
  validateMessage,
  validateStructure,
  type SenderMessage,
  type SenderRequest,
} from "./internal/validation";

export type SenderDeps = DeliverDeps & {
    queue: Enqueuer;
    errors: { record(entry: NewSendingError): Promise<void> };
    inspector: EmailInspector;
    clock?: () => Date;
    /** Randomness for wake-up jitter; inject a constant in tests. */
    rng?: () => number;
  };

const NEXT_STAGE: Record<SenderSteps, SenderSteps | null> = {
  [SenderSteps.CLEAN_DATA]: SenderSteps.CALCULATE_LIMITS,
  [SenderSteps.CALCULATE_LIMITS]: SenderSteps.CALCULATE_DEAD_TIME,
  [SenderSteps.CALCULATE_DEAD_TIME]: SenderSteps.DELIVER,
  [SenderSteps.DELIVER]: null,
};

const STAGE_PREFIX = `${JobNames.SENDER_PROCESS}:`;

function stageOf(jobName: string): SenderSteps | null {
  const stage = jobName.startsWith(STAGE_PREFIX) ? jobName.slice(STAGE_PREFIX.length) : jobName;
  return (Object.values(SenderSteps) as string[]).includes(stage) ? (stage as SenderSteps) : null;
}

/**
 * Job id of one stage run of one message. Stages get distinct ids, and so
 * does every reschedule, while a retried job that enqueues the same
 * transition again produces the same id and is deduplicated by the queue.
 */
function stageJobId(message: SenderMessage, stage: SenderSteps): string {
  return `send:${message.pipeline.key}:${stage}:${message.pipeline.reschedules}`;
}

/**
 * The sender's step machine. A request enters through `handleRequest`
 * (the automation.execute.external queue), then travels
 * CLEAN_DATA → CALCULATE_LIMITS → CALCULATE_DEAD_TIME → DELIVER as separate
 * jobs on sender.process. Each stage returns a StageResult and `advance`
 * turns it into the next job, a delayed re-run, or a recorded error.
 */
export function createSenderPipeline(deps: SenderDeps) {
  const clock = deps.clock ?? (() => new Date());
  const rng = deps.rng ?? Math.random;

  const logContext = (m: SenderRequest) => ({
    automationId: m.automationId,
    recipientId: m.recipientData.id,
    channel: m.content.type,
  });

  const recordError = (m: SenderRequest, stage: string, error: string, warningLevel?: string) =>
    deps.errors.record({
      automationId: m.automationId,
      recipientType: m.recipientData.type,
      recipientId: m.recipientData.id,
      userId: m.userId,
      businessId: m.businessId,
      channel: m.content.type,
      stage,
      error,
      warningLevel: warningLevel ?? null,
    });

  const enqueueStage = (message: SenderMessage, stage: SenderSteps, delay?: number) =>
    deps.queue.enqueue(JobNames.SENDER_PROCESS, message satisfies SenderProcessPayload, {
      jobId: stageJobId(message, stage),
      customJobName: stage,
      attempts: STAGE_ATTEMPTS,
      ...(delay ? { delay } : {}),
    });

  async function advance(message: SenderMessage, stage: SenderSteps, outcome: StageResult): Promise<void> {
    switch (outcome.result) {
      case "SUCCESS": {
        const next = NEXT_STAGE[stage];
        if (outcome.done || !next) return;
        await enqueueStage(outcome.payload ?? message, next);
        return;
      }
      case "DELAY":
      case "RETRY": {
        const reschedules = message.pipeline.reschedules + 1;
        if (reschedules > MAX_RESCHEDULES) {
          logger.error({ ...logContext(message), stage }, "Message rescheduled too many times; giving up");
          await recordError(message, stage, `Gave up after ${MAX_RESCHEDULES} reschedules (${outcome.reason})`);
          return;
        }
        // A DELAY without a duration is treated as a plain retry, never dropped.
        const delay =
          outcome.result === "DELAY" && outcome.delayMs !== undefined ? outcome.delayMs : DEFAULT_RETRY_DELAY_MS;
        const target = (outcome.result === "DELAY" && outcome.stage) || stage;
        logger.info({ ...logContext(message), stage: target, delay, reason: outcome.reason }, "Message rescheduled");
        await enqueueStage({ ...message, pipeline: { ...message.pipeline, reschedules } }, target, delay);
        return;
      }
      case "FAILURE":
      case "DANGER":
        logger.warn({ ...logContext(message), stage, result: outcome.result, error: outcome.error }, "Message not sent");
        await recordError(message, stage, outcome.error, outcome.warningLevel);
        return;
    }
  }

  async function runStage(stage: SenderSteps, message: SenderMessage, now: Date): Promise<StageResult> {
    switch (stage) {
      case SenderSteps.CLEAN_DATA:
        return SENDER_CLEAN_DATA(message, deps.inspector);
      case SenderSteps.CALCULATE_LIMITS:
        return SENDER_LIMITS(message, deps, now, rng);
      case SenderSteps.CALCULATE_DEAD_TIME:
        return SENDER_DEADTIME(message.userId, message.businessId, deps, now);
      case SenderSteps.DELIVER:
        return SENDER_DELIVER(message, deps, now, rng);
    }
  }

  return {
    /** automation.execute.external: validate, then start the pipeline. */
    async handleRequest(job: JobContext<AutomationExecuteExternalPayload>): Promise<void> {
      const request = validateStructure(job.data);
      const problem = validateBusinessRules(request);
      if (problem) {
        logger.warn({ ...logContext(request), problem }, "Request rejected");
        await recordError(request, "VALIDATE_REQUEST", problem);
        return;
      }
      const message: SenderMessage = { ...request, pipeline: { key: messageKey(request), reschedules: 0 } };
      await enqueueStage(message, SenderSteps.CLEAN_DATA);
    },

    /** sender.process: run one stage of one message. */
    async handleStage(job: JobContext<SenderProcessPayload>): Promise<void> {
      const stage = stageOf(job.name);
      if (!stage) throw new UnrecoverableJobError(`Unknown sender stage in job name "${job.name}"`);
      const message = validateMessage(job.data);

      let outcome: StageResult;
      try {
        outcome = await runStage(stage, message, clock());
      } catch (err) {
        // Let the queue retry transient failures; record the final one.
        if (job.attemptsMade + 1 >= STAGE_ATTEMPTS) {
          const reason = err instanceof Error ? err.message : String(err);
          await recordError(message, stage, `Failed after ${STAGE_ATTEMPTS} attempts: ${reason}`);
        }
        throw err;
      }
      await advance(message, stage, outcome);
    },
  };
}
