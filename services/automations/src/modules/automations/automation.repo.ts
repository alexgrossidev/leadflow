import { and, asc, eq, isNull, notInArray, sql } from "drizzle-orm";
import { db } from "../../core/db";
import { automations, type AutomationRow } from "./automation.table";
import { automationSteps, type AutomationStep } from "./automation.step.table";
import type { AutomationPayload } from "./automation.schema";

export class AutomationRepository {
  /**
   * Writes the rule and its steps atomically. Steps are keyed by
   * (automation_id, step_sequence); on update, steps that are no longer in the
   * payload are removed so the local copy matches the gateway exactly.
   *
   * The pause flag is only taken from the payload on first insert: afterwards
   * it changes exclusively through automation.paused, which also moves targets.
   */
  async upsertWithSteps(payload: AutomationPayload): Promise<void> {
    const { steps, ...rule } = payload;
    await db.transaction(async (tx) => {
      await tx
        .insert(automations)
        .values({
          id: rule.id,
          user_id: rule.user_id,
          business_id: rule.business_id,
          name: rule.name,
          automationType: rule.automationType,
          paused: rule.paused,
          pausedAt: rule.paused ? new Date() : null,
          field: rule.field,
          operator: rule.operator,
          value: rule.value,
        })
        .onDuplicateKeyUpdate({
          set: {
            user_id: rule.user_id,
            business_id: rule.business_id,
            name: rule.name,
            automationType: rule.automationType,
            field: rule.field,
            operator: rule.operator,
            value: rule.value,
          },
        });

      await tx
        .insert(automationSteps)
        .values(
          steps.map((step) => ({
            automation_id: rule.id,
            title: step.title,
            description: step.description,
            stepType: step.stepType,
            subject: step.subject,
            content: step.content,
            attachments: step.attachments,
            delay: step.delay,
            delay_unit: step.delay_unit,
            step_sequence: step.step_sequence,
          })),
        )
        .onDuplicateKeyUpdate({
          set: {
            title: sql`values(${automationSteps.title})`,
            description: sql`values(${automationSteps.description})`,
            stepType: sql`values(${automationSteps.stepType})`,
            subject: sql`values(${automationSteps.subject})`,
            content: sql`values(${automationSteps.content})`,
            attachments: sql`values(${automationSteps.attachments})`,
            delay: sql`values(${automationSteps.delay})`,
            delay_unit: sql`values(${automationSteps.delay_unit})`,
          },
        });

      await tx.delete(automationSteps).where(
        and(
          eq(automationSteps.automation_id, rule.id),
          notInArray(
            automationSteps.step_sequence,
            steps.map((step) => step.step_sequence),
          ),
        ),
      );
    });
  }

  async getById(id: number): Promise<AutomationRow | null> {
    const [row] = await db.select().from(automations).where(eq(automations.id, id)).limit(1);
    return row ?? null;
  }

  async getSteps(automationId: number): Promise<AutomationStep[]> {
    return db
      .select()
      .from(automationSteps)
      .where(eq(automationSteps.automation_id, automationId))
      .orderBy(asc(automationSteps.step_sequence));
  }

  /** Automations of a business that may enrol new contacts right now. */
  async listActive(businessId: number, type: "lead" | "customer"): Promise<AutomationRow[]> {
    return db
      .select()
      .from(automations)
      .where(
        and(
          eq(automations.business_id, businessId),
          eq(automations.automationType, type),
          eq(automations.paused, false),
          isNull(automations.scheduledDeletionAt),
        ),
      );
  }
}
