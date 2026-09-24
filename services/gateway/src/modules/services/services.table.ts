import {
  boolean,
  decimal,
  index,
  int,
  mysqlTable,
  text,
  varchar,
} from "drizzle-orm/mysql-core";

/** Catalogue of services a business offers (what customers get assigned to). */
export const services = mysqlTable(
  "services",
  {
    id: int("id").notNull().primaryKey().autoincrement(),
    businessId: int("business_id").notNull(),
    serviceCategory: varchar("service_category", { length: 255 }),
    sortOrder: int("sort_order"),
    name: varchar("name", { length: 255 }),
    description: text("description"),
    price: decimal("price", { precision: 10, scale: 2 }),
    duration: int("duration"),
    durationUnit: varchar("duration_unit", { length: 50 }),
    isPopular: boolean("is_popular").default(false),
    photoUrl: text("photo_url"),
    active: boolean("active").default(true),
  },
  (table) => [index("idx_services_business").on(table.businessId)],
);

export type BusinessService = typeof services.$inferSelect;
