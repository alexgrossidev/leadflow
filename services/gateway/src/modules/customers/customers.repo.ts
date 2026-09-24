import { randomBytes } from "crypto";
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { DbExecutor, mainDb } from "#database/mainPool";
import { logger } from "#core/logger";
import { ConflictError, NotFoundError } from "#core/errors/http-errors";
import { customers } from "./customers.table.js";
import { customFieldValue } from "./customers.values.table.js";
import { customField } from "./customers.fields.table.js";
import { customersStaging } from "./customers.staging.table.js";
import { CustomerFieldValue, EavStagingRecord } from "./customer.types.js";
import { STAGING_CHUNK_SIZE, chunk, validateRecord } from "./customers.utils.js";

export interface NewCustomerInput {
  businessId: number;
  userId: number;
  name: string | null;
  email: string | null;
  phone: string | null;
  dataHash: string;
}

export interface CustomerCoreUpdate {
  name?: string;
  email?: string;
  phone?: string;
}

const EMAIL_TAKEN = "A customer with this email already exists";

export class CustomerRepository {
  // ── Custom field definitions ────────────────────────────────────────────

  async createColumn(userId: number, businessId: number, field: string): Promise<number> {
    const [result] = await mainDb.insert(customField).values({ businessId, userId, field });
    return result.insertId;
  }

  async updateColumn(
    id: number,
    businessId: number,
    userId: number,
    field: string,
  ): Promise<void> {
    const [result] = await mainDb
      .update(customField)
      .set({ field, userId })
      .where(
        and(
          eq(customField.id, id),
          eq(customField.businessId, businessId),
          isNull(customField.deletedAt),
        ),
      );
    if (result.affectedRows === 0) throw new NotFoundError("Custom field not found");
  }

  async deleteColumn(id: number, businessId: number): Promise<void> {
    const [result] = await mainDb
      .update(customField)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(customField.id, id),
          eq(customField.businessId, businessId),
          isNull(customField.deletedAt),
        ),
      );
    if (result.affectedRows === 0) throw new NotFoundError("Custom field not found");
  }

  async getColumns(businessId: number) {
    return mainDb
      .select({ id: customField.id, name: customField.field })
      .from(customField)
      .where(and(eq(customField.businessId, businessId), isNull(customField.deletedAt)));
  }

  /**
   * Idempotently resolves a field slug to its definition id, reviving the
   * definition if it had been soft-deleted.
   */
  async ensureCustomFieldDefinition(
    businessId: number,
    userId: number,
    fieldSlug: string,
    db: DbExecutor = mainDb,
  ): Promise<number> {
    await db
      .insert(customField)
      .values({ businessId, userId, field: fieldSlug })
      .onDuplicateKeyUpdate({ set: { deletedAt: null } });

    const [row] = await db
      .select({ id: customField.id })
      .from(customField)
      .where(and(eq(customField.businessId, businessId), eq(customField.field, fieldSlug)))
      .limit(1);

    if (!row) throw new Error("Custom field definition missing after upsert");
    return row.id;
  }

  async upsertCustomValue(
    payload: {
      businessId: number;
      userId: number;
      customerId: number;
      customFieldId: number;
      value: string | null;
    },
    db: DbExecutor = mainDb,
  ): Promise<void> {
    await db
      .insert(customFieldValue)
      .values({
        businessId: payload.businessId,
        userId: payload.userId,
        customerId: payload.customerId,
        customFieldId: payload.customFieldId,
        customFieldValue: payload.value,
      })
      .onDuplicateKeyUpdate({ set: { customFieldValue: payload.value } });
  }

  // ── Customers ───────────────────────────────────────────────────────────

  async existsInBusiness(
    customerId: number,
    businessId: number,
    db: DbExecutor = mainDb,
  ): Promise<boolean> {
    const [row] = await db
      .select({ id: customers.id })
      .from(customers)
      .where(
        and(
          eq(customers.id, customerId),
          eq(customers.businessId, businessId),
          isNull(customers.deletedAt),
        ),
      )
      .limit(1);
    return Boolean(row);
  }

  async getOne(id: number, businessId: number) {
    const [core] = await mainDb
      .select({
        id: customers.id,
        businessId: customers.businessId,
        userId: customers.userId,
        name: customers.name,
        email: customers.email,
        phone: customers.phone,
        created: customers.created,
        updated: customers.updated,
      })
      .from(customers)
      .where(
        and(
          eq(customers.id, id),
          eq(customers.businessId, businessId),
          isNull(customers.deletedAt),
        ),
      )
      .limit(1);

    if (!core) return null;

    const fields: CustomerFieldValue[] = await mainDb
      .select({
        id: customField.id,
        name: customField.field,
        value: customFieldValue.customFieldValue,
      })
      .from(customFieldValue)
      .innerJoin(customField, eq(customFieldValue.customFieldId, customField.id))
      .where(
        and(
          eq(customFieldValue.customerId, id),
          eq(customFieldValue.businessId, businessId),
          isNull(customField.deletedAt),
        ),
      );

    return { ...core, fields };
  }

  /**
   * Records the row in the staging log (deduplicated by content hash) and
   * inserts the customer. Resubmitting the same person is idempotent and
   * returns the existing id; a different person with the same email is a
   * conflict. Call inside the caller's transaction.
   */
  async createCustomer(input: NewCustomerInput, db: DbExecutor = mainDb): Promise<number> {
    await db
      .insert(customersStaging)
      .values({
        businessId: input.businessId,
        userId: input.userId,
        name: input.name,
        email: input.email,
        phone: input.phone,
        importSourceKey: "MANUAL",
        dataHash: input.dataHash,
        status: "processed",
      })
      .onDuplicateKeyUpdate({ set: { status: "processed" } });

    if (input.email) {
      const [existing] = await db
        .select({ id: customers.id, name: customers.name })
        .from(customers)
        .where(and(eq(customers.businessId, input.businessId), eq(customers.email, input.email)))
        .limit(1);

      if (existing) {
        // Same person resubmitted: idempotent. Anyone else: conflict, without
        // echoing the other customer's name or id back to the caller.
        if (existing.name === input.name) return existing.id;
        throw new ConflictError(EMAIL_TAKEN, "CUSTOMER_EMAIL_TAKEN");
      }
    }

    const [result] = await db.insert(customers).values({
      businessId: input.businessId,
      userId: input.userId,
      name: input.name,
      email: input.email,
      phone: input.phone,
    });
    return result.insertId;
  }

  /** Updates core columns of an active customer; call inside the caller's transaction. */
  async updateCustomerCore(
    id: number,
    businessId: number,
    updates: CustomerCoreUpdate,
    db: DbExecutor = mainDb,
  ): Promise<void> {
    const active = and(
      eq(customers.id, id),
      eq(customers.businessId, businessId),
      isNull(customers.deletedAt),
    );

    const [current] = await db
      .select({ id: customers.id, email: customers.email })
      .from(customers)
      .where(active)
      .limit(1)
      .for("update");
    if (!current) throw new NotFoundError("Customer not found");

    const changes = Object.fromEntries(
      Object.entries(updates).filter(([, value]) => value !== undefined),
    ) as CustomerCoreUpdate;
    if (Object.keys(changes).length === 0) return;

    if (changes.email && changes.email !== current.email) {
      const [clash] = await db
        .select({ id: customers.id })
        .from(customers)
        .where(
          and(
            eq(customers.businessId, businessId),
            eq(customers.email, changes.email),
            ne(customers.id, id),
          ),
        )
        .limit(1);
      if (clash) throw new ConflictError(EMAIL_TAKEN, "CUSTOMER_EMAIL_TAKEN");
    }

    await db.update(customers).set(changes).where(active);
  }

  async softDeleteCustomer(id: number, businessId: number): Promise<void> {
    const [result] = await mainDb
      .update(customers)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(customers.id, id),
          eq(customers.businessId, businessId),
          isNull(customers.deletedAt),
        ),
      );
    if (result.affectedRows === 0) throw new NotFoundError("Customer not found");
  }

  async softDeleteAllByBusinessId(businessId: number, db: DbExecutor = mainDb): Promise<number> {
    const [result] = await db
      .update(customers)
      .set({ deletedAt: sql`CURRENT_TIMESTAMP` })
      .where(and(eq(customers.businessId, businessId), isNull(customers.deletedAt)));
    return result.affectedRows;
  }

  /** Loads one page of customers with their custom fields in a single query. */
  async hydrateCustomerEavBatch(customerIds: number[], businessId: number) {
    if (customerIds.length === 0) return [];

    return mainDb
      .select({
        customerId: customers.id,
        customerName: customers.name,
        customerEmail: customers.email,
        customerPhone: customers.phone,
        customerUserId: customers.userId,
        customerBusinessId: customers.businessId,
        customerCreated: customers.created,
        customerUpdated: customers.updated,
        fieldName: customField.field,
        fieldValue: customFieldValue.customFieldValue,
        fieldId: customField.id,
      })
      .from(customers)
      .leftJoin(customFieldValue, eq(customers.id, customFieldValue.customerId))
      .leftJoin(
        customField,
        and(eq(customFieldValue.customFieldId, customField.id), isNull(customField.deletedAt)),
      )
      .where(and(inArray(customers.id, customerIds), eq(customers.businessId, businessId)))
      .orderBy(customers.id);
  }

  // ── Bulk import ─────────────────────────────────────────────────────────

  /**
   * Upserts a batch of imported customers and their custom fields with a
   * handful of set-based statements instead of one round trip per cell.
   *
   * Rows land in a per-call temporary table first; rows that cannot be
   * imported (no email to match on, or an email owned by a differently named
   * customer) are moved to the dead-letter table, and the rest are merged into
   * the staging log, field definitions, customers and values. Everything runs
   * in one transaction, so a failed batch leaves no partial state.
   */
  async pureSQLCustomerIngestion(
    businessId: number,
    userId: number,
    importJobId: string,
    stagingRecords: EavStagingRecord[],
    db: DbExecutor = mainDb,
  ): Promise<void> {
    if (stagingRecords.length === 0) return;
    stagingRecords.forEach(validateRecord);

    const tmp = sql.raw(
      `tmp_eav_${importJobId.replace(/[^a-zA-Z0-9]/g, "").slice(0, 32)}_${randomBytes(4).toString("hex")}`,
    );
    const log = logger.child({ importJobId, businessId, rows: stagingRecords.length });
    log.info("Customer batch ingestion started");

    await db.transaction(async (tx) => {
      // Temporary tables are exempt from MySQL's implicit commit rules, but
      // ALTER TABLE is not, so the indexes are declared up front: adding them
      // later would silently commit the transaction half-way through.
      await tx.execute(sql`
        CREATE TEMPORARY TABLE ${tmp} (
          import_source_key VARCHAR(255) NOT NULL,
          customer_name     VARCHAR(255) DEFAULT NULL,
          customer_email    VARCHAR(255) DEFAULT NULL,
          customer_phone    VARCHAR(100) DEFAULT NULL,
          field_slug        VARCHAR(255) NOT NULL,
          field_value       TEXT         DEFAULT NULL,
          row_hash          VARCHAR(64)  NOT NULL,
          INDEX idx_tmp_email (customer_email),
          INDEX idx_tmp_slug (field_slug)
        ) ENGINE=InnoDB
      `);

      try {
        for (const records of chunk(stagingRecords, STAGING_CHUNK_SIZE)) {
          const rows = records.map(
            (r) =>
              sql`(${r.importSourceKey}, ${r.name}, ${r.email}, ${r.phone}, ${r.fieldSlug}, ${r.fieldValue}, ${r.hash})`,
          );
          await tx.execute(sql`
            INSERT INTO ${tmp}
              (import_source_key, customer_name, customer_email, customer_phone, field_slug, field_value, row_hash)
            VALUES ${sql.join(rows, sql`, `)}
          `);
        }

        // 1. Dead-letter rows that cannot be matched to a customer identity.
        await tx.execute(sql`
          INSERT INTO customers_v2_failed_imports
            (business_id, user_id, import_job_id, import_source_key, customer_name,
             customer_email, customer_phone, field_slug, field_value, row_hash, failure_reason)
          SELECT ${businessId}, ${userId}, ${importJobId}, t.import_source_key, t.customer_name,
                 t.customer_email, t.customer_phone, t.field_slug, t.field_value, t.row_hash,
                 'Missing email: imported customers are matched by email'
          FROM ${tmp} t
          WHERE t.customer_email IS NULL OR t.customer_email = ''
        `);
        await tx.execute(sql`
          DELETE FROM ${tmp} WHERE customer_email IS NULL OR customer_email = ''
        `);

        // 2. Dead-letter rows whose email belongs to a differently named customer.
        await tx.execute(sql`
          INSERT INTO customers_v2_failed_imports
            (business_id, user_id, import_job_id, import_source_key, customer_name,
             customer_email, customer_phone, field_slug, field_value, row_hash, failure_reason)
          SELECT ${businessId}, ${userId}, ${importJobId}, t.import_source_key, t.customer_name,
                 t.customer_email, t.customer_phone, t.field_slug, t.field_value, t.row_hash,
                 'Email already belongs to a different customer'
          FROM ${tmp} t
          INNER JOIN customers_v2 c
            ON c.email = t.customer_email AND c.business_id = ${businessId} AND c.deleted_at IS NULL
          WHERE t.customer_name <> c.name
        `);
        await tx.execute(sql`
          DELETE t FROM ${tmp} t
          INNER JOIN customers_v2 c
            ON c.email = t.customer_email AND c.business_id = ${businessId} AND c.deleted_at IS NULL
          WHERE t.customer_name <> c.name
        `);

        // 3. Permanent staging log (content-hash deduplicated).
        await tx.execute(sql`
          INSERT INTO customers_v2_staging
            (business_id, user_id, name, email, phone, import_source_key, data_hash, status)
          SELECT DISTINCT ${businessId}, ${userId}, customer_name, customer_email, customer_phone,
                 import_source_key, row_hash, 'processed'
          FROM ${tmp}
          ON DUPLICATE KEY UPDATE status = 'processed'
        `);

        // 4. Field definitions (reviving soft-deleted ones).
        await tx.execute(sql`
          INSERT INTO customers_v2_customfields (business_id, user_id, field)
          SELECT DISTINCT ${businessId}, ${userId}, field_slug
          FROM ${tmp}
          WHERE field_slug <> ''
          ON DUPLICATE KEY UPDATE deleted_at = NULL
        `);

        // 5. Customer identities, keyed by (business_id, email).
        await tx.execute(sql`
          INSERT INTO customers_v2 (business_id, user_id, name, email, phone)
          SELECT DISTINCT ${businessId}, ${userId}, customer_name, customer_email, customer_phone
          FROM ${tmp}
          ON DUPLICATE KEY UPDATE
            name = VALUES(name),
            phone = VALUES(phone),
            deleted_at = NULL,
            updated = CURRENT_TIMESTAMP
        `);

        // 6. Custom field values.
        await tx.execute(sql`
          INSERT INTO customers_v2_customvalues
            (business_id, user_id, customer_id, customfield_id, customfield_value)
          SELECT ${businessId}, ${userId}, c.id, f.id, t.field_value
          FROM ${tmp} t
          INNER JOIN customers_v2 c
            ON c.email = t.customer_email AND c.business_id = ${businessId}
          INNER JOIN customers_v2_customfields f
            ON f.field = t.field_slug AND f.business_id = ${businessId}
          WHERE t.field_value IS NOT NULL AND TRIM(t.field_value) <> ''
          ON DUPLICATE KEY UPDATE customfield_value = VALUES(customfield_value)
        `);
      } finally {
        // Temporary tables live as long as the pooled connection, not the
        // transaction, so drop it explicitly even when a statement failed.
        await tx.execute(sql`DROP TEMPORARY TABLE IF EXISTS ${tmp}`);
      }
    });

    log.info("Customer batch ingestion completed");
  }
}
