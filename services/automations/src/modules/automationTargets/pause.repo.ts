import { and, eq, gt, inArray, isNull, sql, asc } from "drizzle-orm";
import { db, type Tx } from "../../core/db";
import { BATCH_SIZE, SKIP_REASONS } from "../../config/constants";
import { automations } from "../automations/automation.table";
import { automationSteps } from "../automations/automation.step.table";
import { skips } from "../skipped/skipped.table";
import { targets, type Target } from "./target.table";
import { deleteTargetsOf, replaceTargets } from "./target.repo";
import { toRestoredTarget, toSkippedTarget } from "./target.schedule";
import type { PauseStore, RestoreBatch, RestoredTarget } from "./pause.types";

async function lockAutomation(tx: Tx, automationId: number) {
  const [row] = await tx
    .select({
      paused: automations.paused,
      pausedAt: automations.pausedAt,
      scheduledDeletionAt: automations.scheduledDeletionAt,
    })
    .from(automations)
    .where(eq(automations.id, automationId))
    .for("update");
  return row ?? null;
}

const toRestored = (row: Pick<Target, "automationId" | "type" | "originalId" | "pausedTime">): RestoredTarget => ({
  automationId: row.automationId,
  type: row.type,
  originalId: row.originalId,
  pausedTime: row.pausedTime,
});

export class PauseRepository implements PauseStore {
  async pauseAutomation(automationId: number, now: Date): Promise<Date | null> {
    return db.transaction(async (tx) => {
      const [result] = await tx
        .update(automations)
        .set({ paused: true, pausedAt: now })
        .where(
          and(
            eq(automations.id, automationId),
            eq(automations.paused, false),
            isNull(automations.scheduledDeletionAt),
          ),
        );
      if (result.affectedRows === 0) return null;
      await tx
        .update(targets)
        .set({ paused: true, pausedTime: now })
        .where(and(eq(targets.automationId, automationId), eq(targets.paused, false)));
      return now;
    });
  }

  async resumeAutomation(automationId: number): Promise<Date | null> {
    return db.transaction(async (tx) => {
      const current = await lockAutomation(tx, automationId);
      if (!current || !current.paused || current.scheduledDeletionAt) return null;
      await tx
        .update(automations)
        .set({ paused: false, pausedAt: null })
        .where(eq(automations.id, automationId));
      return current.pausedAt ?? new Date(0);
    });
  }

  async markForDeletion(automationId: number, now: Date): Promise<boolean> {
    return db.transaction(async (tx) => {
      const [result] = await tx
        .update(automations)
        .set({
          paused: true,
          pausedAt: sql`coalesce(${automations.pausedAt}, ${now})`,
          scheduledDeletionAt: now,
        })
        .where(and(eq(automations.id, automationId), isNull(automations.scheduledDeletionAt)));
      if (result.affectedRows === 0) return false;
      await tx
        .update(targets)
        .set({ paused: true, pausedTime: now })
        .where(and(eq(targets.automationId, automationId), eq(targets.paused, false)));
      return true;
    });
  }

  async sweepPausedTargets(automationId: number, limit: number, now: Date): Promise<number | null> {
    return db.transaction(async (tx) => {
      const automation = await lockAutomation(tx, automationId);
      if (!automation?.paused) return null;

      const rows = await tx
        .select()
        .from(targets)
        .where(and(eq(targets.automationId, automationId), eq(targets.paused, true)))
        .limit(limit);
      if (rows.length === 0) return 0;

      for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        await tx
          .insert(skips)
          .values(rows.slice(i, i + BATCH_SIZE).map((row) => toSkippedTarget(row, SKIP_REASONS.PAUSE, now)))
          .onDuplicateKeyUpdate({
            set: {
              step: sql`values(${skips.step})`,
              stepId: sql`values(${skips.stepId})`,
              pausedTime: sql`values(${skips.pausedTime})`,
              lastExecutionTime: sql`values(${skips.lastExecutionTime})`,
              expectedExecutionTime: sql`values(${skips.expectedExecutionTime})`,
              reasonCode: sql`values(${skips.reasonCode})`,
              skippedAt: sql`values(${skips.skippedAt})`,
            },
          });
      }
      await deleteTargetsOf(tx, automationId, rows);
      return rows.length;
    });
  }

  async restoreSkipped(
    automationId: number,
    afterId: number,
    limit: number,
    now: Date,
  ): Promise<RestoreBatch | null> {
    return db.transaction(async (tx) => {
      const automation = await lockAutomation(tx, automationId);
      if (!automation || automation.paused || automation.scheduledDeletionAt) return null;

      const rows = await tx
        .select()
        .from(skips)
        .where(and(eq(skips.automationId, automationId), gt(skips.id, afterId)))
        .orderBy(asc(skips.id))
        .limit(limit);
      if (rows.length === 0) return { restored: [], lastId: afterId };

      await replaceTargets(tx, rows.map((row) => toRestoredTarget(row, now)));
      const ids = rows.map((row) => row.id);
      for (let i = 0; i < ids.length; i += BATCH_SIZE) {
        await tx.delete(skips).where(inArray(skips.id, ids.slice(i, i + BATCH_SIZE)));
      }
      return { restored: rows.map(toRestored), lastId: ids[ids.length - 1] ?? afterId };
    });
  }

  async restorePausedInPlace(automationId: number, limit: number, now: Date): Promise<RestoredTarget[] | null> {
    return db.transaction(async (tx) => {
      const automation = await lockAutomation(tx, automationId);
      if (!automation || automation.paused || automation.scheduledDeletionAt) return null;

      const rows = await tx
        .select()
        .from(targets)
        .where(and(eq(targets.automationId, automationId), eq(targets.paused, true)))
        .limit(limit);
      if (rows.length === 0) return [];

      await replaceTargets(tx, rows.map((row) => toRestoredTarget(row, now)));
      return rows.map(toRestored);
    });
  }

  async purgeDeleted(automationId: number, limit: number): Promise<{ finished: boolean }> {
    return db.transaction(async (tx) => {
      const automation = await lockAutomation(tx, automationId);
      if (!automation) return { finished: true };
      if (!automation.scheduledDeletionAt) {
        throw new Error(`Automation ${automationId} is not scheduled for deletion`);
      }

      const [deletedTargets] = await tx
        .delete(targets)
        .where(eq(targets.automationId, automationId))
        .limit(limit);
      const [deletedSkips] = await tx
        .delete(skips)
        .where(eq(skips.automationId, automationId))
        .limit(limit);
      if (deletedTargets.affectedRows >= limit || deletedSkips.affectedRows >= limit) {
        return { finished: false };
      }

      await tx.delete(automationSteps).where(eq(automationSteps.automation_id, automationId));
      await tx.delete(automations).where(eq(automations.id, automationId));
      return { finished: true };
    });
  }
}
