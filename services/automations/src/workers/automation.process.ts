import { logger, type JobContext } from "@leadflow/shared";
import { JobNames, type AutomationExecuteInternalPayload } from "@leadflow/shared/jobs";
import { jobIds } from "../core/jobIds";
import type { Enqueuer } from "../core/queue";
import type { AutomationRow } from "../modules/automations/automation.table";
import type { AutomationStep } from "../modules/automations/automation.step.table";
import type { Contact } from "../modules/contacts/contact.table";
import type { ScheduleUpdate } from "../modules/automationTargets/target.repo";
import type { Target, TargetKey } from "../modules/automationTargets/target.table";
import { calculateExpectedRuntime } from "../modules/automationTargets/target.schedule";

export interface ExecutionDeps {
  automations: {
    getById(id: number): Promise<AutomationRow | null>;
    getSteps(automationId: number): Promise<AutomationStep[]>;
  };
  targets: {
    get(key: TargetKey): Promise<Target | null>;
    markPaused(key: TargetKey, now: Date): Promise<void>;
    updateSchedule(key: TargetKey, update: ScheduleUpdate): Promise<void>;
  };
  contacts: {
    get(originalId: number, type: "lead" | "customer", businessId: number): Promise<Contact | null>;
  };
  queue: Enqueuer;
  clock?: () => Date;
}

/**
 * Drives one target through its automation, one step per run:
 *
 * 1. stand down if the automation is deleted, or paused (the pause sweep parks the target);
 * 2. if the current step is not due yet, persist its due time and re-enqueue for then;
 * 3. otherwise hand the step to the sender, advance the target to the next step,
 *    and schedule that step's run.
 *
 * Waiting happens in this service rather than as a delayed sender job, so a
 * pause takes effect on everything that has not been handed off yet. Every
 * enqueue uses a deterministic id, so a retried run cannot send a step twice.
 */
export function createExecutionHandler(deps: ExecutionDeps) {
  const clock = deps.clock ?? (() => new Date());

  const scheduleRun = (target: Target, sequence: number, dueAt: Date, now: Date) =>
    deps.queue.enqueue(
      JobNames.AUTOMATION_EXECUTE_INTERNAL,
      {
        automationId: target.automationId,
        userId: target.userId,
        leadId: target.originalId,
        type: target.type,
        executionType: "launch",
      },
      { jobId: jobIds.step(target, sequence, dueAt), delay: Math.max(0, dueAt.getTime() - now.getTime()) },
    );

  return async function AUTOMATION_EXECUTE_INTERNAL(
    job: JobContext<AutomationExecuteInternalPayload>,
  ): Promise<void> {
    const { automationId, leadId, type } = job.data;
    const key: TargetKey = { automationId, type, originalId: leadId };
    const now = clock();

    const automation = await deps.automations.getById(automationId);
    if (!automation || automation.scheduledDeletionAt) {
      logger.info({ automationId, leadId }, "Automation deleted; execution dropped");
      return;
    }

    const target = await deps.targets.get(key);
    if (!target) {
      logger.info({ automationId, leadId }, "Target not enrolled (or parked); execution dropped");
      return;
    }

    if (automation.paused || target.paused) {
      // A target enrolled while the pause was committing is flagged here so
      // the sweep, or the restore after resume, picks it up.
      await deps.targets.markPaused(key, now);
      logger.info({ automationId, leadId }, "Automation paused; execution deferred");
      return;
    }

    const steps = await deps.automations.getSteps(automationId);
    const step =
      target.step === null ? steps[0] : steps.find((s) => s.step_sequence === target.step);
    if (!step) {
      logger.info({ automationId, leadId }, "Target has completed every step");
      return;
    }

    const dueAt =
      target.expectedExecutionTime && target.stepId === step.id
        ? target.expectedExecutionTime
        : calculateExpectedRuntime(
            {
              from: target.lastExecutionTime ?? target.enrolledAt,
              delay: step.delay,
              delayUnit: step.delay_unit,
            },
            now,
          );

    if (dueAt.getTime() > now.getTime()) {
      await deps.targets.updateSchedule(key, {
        step: step.step_sequence,
        stepId: step.id,
        expectedExecutionTime: dueAt,
      });
      await scheduleRun(target, step.step_sequence, dueAt, now);
      return;
    }

    const contact = await deps.contacts.get(leadId, type, automation.business_id);
    if (!contact) {
      throw new Error(`Contact ${type}:${leadId} of automation ${automationId} not found`);
    }

    await deps.queue.enqueue(
      JobNames.AUTOMATION_EXECUTE_EXTERNAL,
      {
        automationId,
        userId: target.userId,
        businessId: automation.business_id,
        recipientData: {
          id: leadId,
          type,
          ...(contact.email ? { email: contact.email } : {}),
          ...(contact.phone ? { phone: contact.phone } : {}),
        },
        content: {
          type: step.stepType,
          ...(step.content ? { content: step.content } : {}),
          ...(step.subject ? { subject: step.subject } : {}),
        },
      },
      { jobId: jobIds.deliver(key, step.id) },
    );

    const next = steps.find((s) => s.step_sequence > step.step_sequence);
    const nextDueAt = next
      ? calculateExpectedRuntime({ from: now, delay: next.delay, delayUnit: next.delay_unit }, now)
      : null;

    await deps.targets.updateSchedule(key, {
      step: next ? next.step_sequence : step.step_sequence + 1,
      stepId: next?.id ?? null,
      expectedExecutionTime: nextDueAt,
      lastExecutionTime: now,
    });
    logger.info({ automationId, leadId, stepId: step.id }, "Step handed to sender");

    if (next && nextDueAt) {
      await scheduleRun(target, next.step_sequence, nextDueAt, now);
    }
  };
}
