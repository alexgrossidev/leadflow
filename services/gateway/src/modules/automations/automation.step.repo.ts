import { and, eq, inArray, notInArray } from "drizzle-orm";
import { DbExecutor } from "#database/mainPool";
import { AutomationStep, automationSteps } from "./automation.step.table.js";
import { StepInput } from "./automation.schema.js";

export class AutomationStepRepository {
  /**
   * Makes the automation's steps exactly `steps`, preserving ids: steps whose
   * id already belongs to this automation are updated in place, the rest are
   * inserted, and existing steps missing from the list are deleted. An id that
   * belongs to a different automation is never touched (it becomes a new step).
   * Must run inside the caller's transaction.
   */
  async sync(automationId: number, steps: StepInput[], db: DbExecutor): Promise<AutomationStep[]> {
    const existing = await db
      .select({ id: automationSteps.id })
      .from(automationSteps)
      .where(eq(automationSteps.automation_id, automationId));
    const existingIds = new Set(existing.map((s) => s.id));

    const keptIds: number[] = [];
    for (const { id, ...fields } of steps) {
      if (id !== undefined && existingIds.has(id)) {
        await db
          .update(automationSteps)
          .set(fields)
          .where(and(eq(automationSteps.id, id), eq(automationSteps.automation_id, automationId)));
        keptIds.push(id);
      } else {
        const [result] = await db
          .insert(automationSteps)
          .values({ ...fields, automation_id: automationId });
        keptIds.push(result.insertId);
      }
    }

    await db
      .delete(automationSteps)
      .where(
        and(
          eq(automationSteps.automation_id, automationId),
          keptIds.length > 0 ? notInArray(automationSteps.id, keptIds) : undefined,
        ),
      );

    return keptIds.length === 0
      ? []
      : db
          .select()
          .from(automationSteps)
          .where(inArray(automationSteps.id, keptIds))
          .orderBy(automationSteps.step_sequence, automationSteps.id);
  }

  async deleteAll(automationId: number, db: DbExecutor): Promise<void> {
    await db.delete(automationSteps).where(eq(automationSteps.automation_id, automationId));
  }
}
