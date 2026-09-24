import {
  bigint,
  char,
  customType,
  index,
  int,
  json,
  mysqlTable,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import type { StagingRowStatus } from "#config/constants";

/**
 * drizzle's built-in `binary` column is typed as string, which mysql2 would
 * send as text. The hash is a raw 32-byte digest, so it is typed and passed
 * through as a Buffer.
 */
const sha256Binary = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "binary(32)",
});

export const clientImportStaging = mysqlTable(
  "import_staging",
  {
    id: bigint("id", { mode: "number", unsigned: true })
      .primaryKey()
      .autoincrement(),
    businessId: int("business_id").notNull(),
    importJobId: char("import_job_id", { length: 36 }).notNull(),
    rawData: json("raw_data").notNull(),
    status: varchar("status", { length: 16 })
      .$type<StagingRowStatus>()
      .notNull()
      .default("RAW"),
    /** sha256 of the row (see dispatchers/utils/hash.ts). */
    dataHash: sha256Binary("data_hash").notNull(),
    deliveredAt: timestamp("delivered_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    // Serves the keyset scan: WHERE import_job_id = ? AND status = 'RAW' AND id > ? ORDER BY id.
    index("idx_staging_job_status_id").on(
      table.importJobId,
      table.status,
      table.id,
    ),
    // Identical rows within one file collapse into one staged row.
    uniqueIndex("uidx_job_payload").on(table.importJobId, table.dataHash),
  ],
);

export type ImportStaging = typeof clientImportStaging.$inferSelect;
export type NewImportStaging = typeof clientImportStaging.$inferInsert;
