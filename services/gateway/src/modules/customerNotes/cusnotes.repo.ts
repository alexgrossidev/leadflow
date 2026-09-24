import { and, eq, isNull, sql } from "drizzle-orm";
import { DbExecutor, mainDb } from "#database/mainPool";
import { CustomerNote, NewNote, customerNotes } from "./cusnotes.table.js";
import { UpdateNoteBody } from "./cusnotes.schema.js";

export interface NoteScope {
  businessId: number;
  customerId: number;
}

const activeNote = (id: number, scope: NoteScope) =>
  and(
    eq(customerNotes.id, id),
    eq(customerNotes.businessId, scope.businessId),
    eq(customerNotes.customerId, scope.customerId),
    isNull(customerNotes.deletedAt),
  );

export class CustomerNoteRepository {
  async listForCustomer(scope: NoteScope): Promise<CustomerNote[]> {
    return mainDb
      .select()
      .from(customerNotes)
      .where(
        and(
          eq(customerNotes.customerId, scope.customerId),
          eq(customerNotes.businessId, scope.businessId),
          isNull(customerNotes.deletedAt),
        ),
      );
  }

  /**
   * Idempotent insert: with an idempotency key, a retry hits the unique key and
   * resolves to the id of the note created by the first attempt.
   */
  async insert(input: NewNote, db: DbExecutor = mainDb): Promise<number> {
    const [result] = await db
      .insert(customerNotes)
      .values(input)
      .onDuplicateKeyUpdate({ set: { updatedAt: sql`updated_at` } });

    if (result.insertId) return result.insertId;

    if (input.idempotencyKey) {
      const [existing] = await db
        .select({ id: customerNotes.id })
        .from(customerNotes)
        .where(
          and(
            eq(customerNotes.businessId, input.businessId),
            eq(customerNotes.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);
      if (existing) return existing.id;
    }

    throw new Error("Note insert returned no id");
  }

  async update(
    id: number,
    scope: NoteScope,
    updates: UpdateNoteBody,
    db: DbExecutor = mainDb,
  ): Promise<boolean> {
    const [result] = await db
      .update(customerNotes)
      .set({ ...updates, updatedAt: new Date() })
      .where(activeNote(id, scope));
    return result.affectedRows > 0;
  }

  async softDelete(id: number, scope: NoteScope, db: DbExecutor = mainDb): Promise<boolean> {
    const [result] = await db
      .update(customerNotes)
      .set({ deletedAt: new Date() })
      .where(activeNote(id, scope));
    return result.affectedRows > 0;
  }
}
