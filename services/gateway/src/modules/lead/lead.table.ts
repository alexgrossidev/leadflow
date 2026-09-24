import {
  index,
  int,
  json,
  mysqlTable,
  text,
  timestamp,
  tinyint,
  uniqueIndex,
  varchar,
} from "drizzle-orm/mysql-core";
import { sql } from "drizzle-orm";

export const LEAD_SOURCES = ["facebook", "google_forms", "manual", "import"] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const leads = mysqlTable(
  "leads",
  {
    id: int("id").autoincrement().primaryKey(),
    businessId: int("businessId").notNull(),
    /** Owner of the lead (the business owner for intake, the creator for manual leads). */
    userId: int("user_id").notNull(),
    name: varchar("name", { length: 255 }),
    company: varchar("company", { length: 255 }),
    address: text("address"),
    city: text("city"),
    postcode: text("postcode"),
    email: varchar("email", { length: 255 }),
    phone: varchar("phone", { length: 50 }),
    status: varchar("status", { length: 100 }),
    status_color: varchar("status_color", { length: 50 }),
    last_contact: timestamp("last_contact"),
    value: varchar("value", { length: 100 }),
    notes: text("notes"),
    archived: tinyint("archived").default(0),
    category: varchar("category", { length: 255 }),
    duedate: timestamp("duedate"),
    probability: int("probability"),
    source: varchar("lead_source", { length: 32, enum: LEAD_SOURCES }).notNull().default("manual"),
    /** Id of the lead in the source system (Facebook leadgen id, form response id). */
    externalId: varchar("external_id", { length: 255 }),
    /**
     * Form answers keyed by field slug. Stored as JSON on the lead rather than
     * in the customers EAV tables: leads are written once by intake and read
     * whole (or filtered by one slug), so a JSON column keeps intake to a
     * single insert while MySQL's JSON functions still allow filtering.
     */
    customFields: json("custom_fields").$type<Record<string, string>>(),
    /** Set once `lead.created` has been published; NULL means it still has to be. */
    eventEmittedAt: timestamp("event_emitted_at"),
    created_at: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
    updated_at: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).onUpdateNow(),
  },
  (t) => [
    // Intake idempotency: one lead per source record. Manual leads have a NULL
    // external_id, which the unique index ignores.
    uniqueIndex("uq_leads_business_source_external").on(t.businessId, t.source, t.externalId),
    index("idx_leads_business_id").on(t.businessId, t.id),
  ],
);

export type Lead = typeof leads.$inferSelect;
export type NewLead = typeof leads.$inferInsert;
