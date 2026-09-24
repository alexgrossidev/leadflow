import { and, eq, isNull, sql } from "drizzle-orm";
import { DbExecutor, mainDb } from "#database/mainPool";
import { NewCustomerDocument, customerDocuments } from "./cusdocs.table.js";
import { UpdateDocumentBody } from "./cusdocs.schema.js";

export interface DocumentScope {
  businessId: number;
  customerId: number;
}

const activeDocument = (id: number, scope: DocumentScope) =>
  and(
    eq(customerDocuments.id, id),
    eq(customerDocuments.businessId, scope.businessId),
    eq(customerDocuments.customerId, scope.customerId),
    isNull(customerDocuments.deletedAt),
  );

export class CustomerDocumentsRepository {
  /** Idempotent on (business_id, idempotency_key) when a key is supplied. */
  async create(input: NewCustomerDocument, db: DbExecutor = mainDb): Promise<number> {
    const [result] = await db
      .insert(customerDocuments)
      .values(input)
      .onDuplicateKeyUpdate({ set: { id: sql`id` } });

    if (result.insertId) return result.insertId;

    if (input.idempotencyKey) {
      const [existing] = await db
        .select({ id: customerDocuments.id })
        .from(customerDocuments)
        .where(
          and(
            eq(customerDocuments.businessId, input.businessId),
            eq(customerDocuments.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);
      if (existing) return existing.id;
    }
    throw new Error("Document insert returned no id");
  }

  async listForCustomer(scope: DocumentScope, limit = 100) {
    return mainDb
      .select({
        id: customerDocuments.id,
        customerId: customerDocuments.customerId,
        fileName: customerDocuments.fileName,
        fileType: customerDocuments.fileType,
        fileSizeInBytes: customerDocuments.fileSizeInBytes,
        note: customerDocuments.note,
        uploadedAt: customerDocuments.uploadedAt,
      })
      .from(customerDocuments)
      .where(
        and(
          eq(customerDocuments.businessId, scope.businessId),
          eq(customerDocuments.customerId, scope.customerId),
          isNull(customerDocuments.deletedAt),
        ),
      )
      .limit(limit);
  }

  async findFilePath(id: number, scope: DocumentScope): Promise<string | null> {
    const [row] = await mainDb
      .select({ filePath: customerDocuments.filePath })
      .from(customerDocuments)
      .where(activeDocument(id, scope))
      .limit(1);
    return row?.filePath ?? null;
  }

  async update(id: number, scope: DocumentScope, updates: UpdateDocumentBody): Promise<boolean> {
    const [result] = await mainDb
      .update(customerDocuments)
      .set(updates)
      .where(activeDocument(id, scope));
    return result.affectedRows > 0;
  }

  async softDelete(id: number, scope: DocumentScope): Promise<boolean> {
    const [result] = await mainDb
      .update(customerDocuments)
      .set({ deletedAt: new Date() })
      .where(activeDocument(id, scope));
    return result.affectedRows > 0;
  }
}
