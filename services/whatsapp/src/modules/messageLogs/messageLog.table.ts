import {
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";

export const whatsappMessageLogs = mysqlTable(
  "whatsapp_message_logs",
  {
    id: int("id").autoincrement().notNull().primaryKey(),
    /** The producer's original key (it may contain ":"); never the normalised job id. */
    idempotencyKey: varchar("idempotency_key", { length: 255 }).notNull(),
    status: mysqlEnum("status", ["pending", "sent", "failed"]).notNull().default("pending"),

    userId: int("user_id").notNull(),
    businessId: int("business_id").notNull(),
    automationId: int("automation_id"),
    targetId: int("target_id"),
    recipientId: int("recipient_id"),
    recipientType: varchar("recipient_type", { length: 32 }),
    recipientPhone: varchar("recipient_phone", { length: 64 }).notNull(),

    payloadRef: varchar("payload_ref", { length: 512 }),
    providerMessageId: varchar("provider_message_id", { length: 255 }),

    attempts: int("attempts").notNull().default(0),
    errorCode: varchar("error_code", { length: 128 }),
    errorMessage: text("error_message"),
    errorPayload: json("error_payload"),

    createdAt: timestamp("created_at").notNull().defaultNow(),
    queuedAt: timestamp("queued_at"),
    sentAt: timestamp("sent_at"),
    failedAt: timestamp("failed_at"),
    updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
  },
  (table) => [
    uniqueIndex("whatsapp_message_logs_idempotency_key_uq").on(table.idempotencyKey),
    index("whatsapp_message_logs_status_idx").on(table.status),
    index("whatsapp_message_logs_automation_target_idx").on(table.automationId, table.targetId),
    index("whatsapp_message_logs_business_created_idx").on(table.businessId, table.createdAt),
  ],
);

export type WhatsappMessageLog = typeof whatsappMessageLogs.$inferSelect;
export type NewWhatsappMessageLog = typeof whatsappMessageLogs.$inferInsert;
