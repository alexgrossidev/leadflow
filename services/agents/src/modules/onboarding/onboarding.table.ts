import {
  char,
  json,
  mysqlEnum,
  mysqlTable,
  primaryKey,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";
import type { OnboardingResult } from "#dispatchers/onboarding/types";

export const ONBOARDING_REQUEST_STATUSES = ["in_progress", "completed", "failed"] as const;
export type OnboardingRequestStatus = (typeof ONBOARDING_REQUEST_STATUSES)[number];

/**
 * One row per (userId, Idempotency-Key). Onboarding creates a business, users
 * and automations through the gateway, so a client retry after a timeout must
 * not run it a second time. The request hash detects a key reused for a
 * different body. The stored result is the per-field report (statuses, missing
 * field descriptions, token usage), not the owner's text.
 */
export const onboardingRequests = mysqlTable(
  "onboarding_requests",
  {
    userId: varchar("user_id", { length: 64 }).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 128 }).notNull(),
    requestHash: char("request_hash", { length: 64 }).notNull(),
    status: mysqlEnum("status", ONBOARDING_REQUEST_STATUSES).notNull(),
    result: json("result").$type<OnboardingResult>(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().onUpdateNow().notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.idempotencyKey] })],
);

export type OnboardingRequestRecord = typeof onboardingRequests.$inferSelect;
