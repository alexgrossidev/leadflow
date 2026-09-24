import { and, eq, inArray, sql } from "drizzle-orm";
import { db, type Tx } from "../../core/db";
import { BATCH_SIZE } from "../../config/constants";
import { contacts, type NewContact } from "../contacts/contact.table";
import { targets, type NewTarget, type Target, type TargetKey } from "./target.table";

const byKey = (key: TargetKey) =>
  and(
    eq(targets.automationId, key.automationId),
    eq(targets.type, key.type),
    eq(targets.originalId, key.originalId),
  );

/** Deletes the given targets of ONE automation; never touches other automations' rows. */
export async function deleteTargetsOf(tx: Tx, automationId: number, keys: TargetKey[]): Promise<void> {
  for (const type of ["lead", "customer"] as const) {
    const ids = keys.filter((k) => k.type === type).map((k) => k.originalId);
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      await tx
        .delete(targets)
        .where(
          and(
            eq(targets.automationId, automationId),
            eq(targets.type, type),
            inArray(targets.originalId, ids.slice(i, i + BATCH_SIZE)),
          ),
        );
    }
  }
}

/** Writes full target rows, overwriting any existing row with the same key. */
export async function replaceTargets(tx: Tx, rows: NewTarget[]): Promise<void> {
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    await tx
      .insert(targets)
      .values(rows.slice(i, i + BATCH_SIZE))
      .onDuplicateKeyUpdate({
        set: {
          userId: sql`values(${targets.userId})`,
          businessId: sql`values(${targets.businessId})`,
          step: sql`values(${targets.step})`,
          stepId: sql`values(${targets.stepId})`,
          paused: sql`values(${targets.paused})`,
          pausedTime: sql`values(${targets.pausedTime})`,
          enrolledAt: sql`values(${targets.enrolledAt})`,
          lastExecutionTime: sql`values(${targets.lastExecutionTime})`,
          expectedExecutionTime: sql`values(${targets.expectedExecutionTime})`,
        },
      });
  }
}

export interface ScheduleUpdate {
  step: number;
  stepId: number | null;
  expectedExecutionTime: Date | null;
  lastExecutionTime?: Date;
}

export class TargetRepository {
  async get(key: TargetKey): Promise<Target | null> {
    const [row] = await db.select().from(targets).where(byKey(key)).limit(1);
    return row ?? null;
  }

  /**
   * Enrols contacts in automations in one transaction. Contact addresses are
   * refreshed; an existing enrolment is left untouched so that re-delivered
   * events or a repeated backfill never reset a target's progress.
   */
  async saveEnrolments(newContacts: NewContact[], newTargets: NewTarget[]): Promise<void> {
    if (newContacts.length === 0 && newTargets.length === 0) return;
    await db.transaction(async (tx) => {
      for (let i = 0; i < newContacts.length; i += BATCH_SIZE) {
        await tx
          .insert(contacts)
          .values(newContacts.slice(i, i + BATCH_SIZE))
          .onDuplicateKeyUpdate({
            set: {
              userId: sql`values(${contacts.userId})`,
              email: sql`values(${contacts.email})`,
              phone: sql`values(${contacts.phone})`,
            },
          });
      }
      for (let i = 0; i < newTargets.length; i += BATCH_SIZE) {
        await tx
          .insert(targets)
          .values(newTargets.slice(i, i + BATCH_SIZE))
          .onDuplicateKeyUpdate({ set: { automationId: sql`${targets.automationId}` } });
      }
    });
  }

  async markPaused(key: TargetKey, now: Date): Promise<void> {
    await db
      .update(targets)
      .set({ paused: true, pausedTime: now })
      .where(and(byKey(key), eq(targets.paused, false)));
  }

  async updateSchedule(key: TargetKey, update: ScheduleUpdate): Promise<void> {
    await db.update(targets).set(update).where(byKey(key));
  }
}
