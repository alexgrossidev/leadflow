import { JobNames } from "@leadflow/shared/jobs";
import { jobIds } from "../../core/jobIds";
import type { Enqueuer } from "../../core/queue";
import type { AutomationRow } from "../automations/automation.table";
import type { NewContact } from "../contacts/contact.table";
import type { NewTarget } from "../automationTargets/target.table";

export interface EnrolmentStore {
  saveEnrolments(contacts: NewContact[], targets: NewTarget[]): Promise<void>;
}

export type EnrollingAutomation = Pick<AutomationRow, "id" | "user_id" | "business_id" | "automationType">;

export interface EnrolmentCandidate {
  originalId: number;
  email: string | null;
  phone: string | null;
}

/**
 * Adds contacts to automations: persists contact + target rows in one
 * transaction, then enqueues each target's first execution. Job ids are
 * deterministic, so replaying the same enrolment is a no-op.
 */
export class EnrolmentService {
  constructor(
    private readonly store: EnrolmentStore,
    private readonly queue: Enqueuer,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async enrol(entries: Array<{ automation: EnrollingAutomation; contact: EnrolmentCandidate }>): Promise<number> {
    if (entries.length === 0) return 0;
    const now = this.clock();

    const contacts = new Map<string, NewContact>();
    const targets: NewTarget[] = [];
    for (const { automation, contact } of entries) {
      const type = automation.automationType;
      contacts.set(`${type}:${contact.originalId}:${automation.business_id}`, {
        originalId: contact.originalId,
        type,
        businessId: automation.business_id,
        userId: automation.user_id,
        email: contact.email,
        phone: contact.phone,
      });
      targets.push({
        automationId: automation.id,
        type,
        originalId: contact.originalId,
        userId: automation.user_id,
        businessId: automation.business_id,
        step: null,
        stepId: null,
        paused: false,
        pausedTime: null,
        enrolledAt: now,
        lastExecutionTime: null,
        expectedExecutionTime: null,
      });
    }

    await this.store.saveEnrolments([...contacts.values()], targets);

    await Promise.all(
      targets.map((target) =>
        this.queue.enqueue(
          JobNames.AUTOMATION_EXECUTE_INTERNAL,
          {
            automationId: target.automationId,
            userId: target.userId,
            leadId: target.originalId,
            type: target.type,
            executionType: "launch",
          },
          { jobId: jobIds.enrol(target) },
        ),
      ),
    );
    return targets.length;
  }
}
