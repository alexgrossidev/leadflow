import {
  mysqlTable,
  int,
  varchar,
  timestamp,
  mysqlEnum,
  index,
  uniqueIndex,
  char,
} from "drizzle-orm/mysql-core";

/**
 * Permanent log of every customer row that entered the system (manual or
 * import), keyed by a content hash so a re-imported identical row is a no-op.
 */
export const customersStaging = mysqlTable(
  "customers_v2_staging",
  {
    id: int("id").primaryKey().autoincrement(),
    businessId: int("business_id").notNull(),
    userId: int("user_id").notNull(),
    name: varchar("name", { length: 255 }),
    email: varchar("email", { length: 255 }),
    phone: varchar("phone", { length: 100 }),
    importSourceKey: varchar("import_source_key", { length: 255 }),
    // SHA-256 hex digest of the normalised row (see config/create-hash.ts); the
    // fileparser computes the same digest for imported rows.
    dataHash: char("data_hash", { length: 64 }).notNull(),
    status: mysqlEnum("status", ["pending", "processed", "duplicate", "failed"]).default(
      "pending",
    ),
    created: timestamp("created").defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("uq_stage_dedupe").on(t.businessId, t.dataHash),
    index("idx_stage_status").on(t.status),
  ],
);
