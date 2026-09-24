import { mysqlTable, int, varchar, boolean, mysqlEnum, uniqueIndex } from "drizzle-orm/mysql-core";

/** One row per business and weekday. Times are local to the business's timezone ("HH:MM"). */
export const openingTimes = mysqlTable(
  "opening_times",
  {
    id: int("id").autoincrement().primaryKey(),
    businessId: int("business_id").notNull(),
    day: mysqlEnum("day", ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]).notNull(),
    morningOpen: varchar("morning_open", { length: 8 }),
    morningClose: varchar("morning_close", { length: 8 }),
    afternoonOpen: varchar("afternoon_open", { length: 8 }),
    afternoonClose: varchar("afternoon_close", { length: 8 }),
    /** Open from morning_open to afternoon_close without a break. */
    isContinuous: boolean("is_continuous").notNull().default(false),
    isOpen: boolean("is_open").notNull().default(false),
  },
  (table) => [uniqueIndex("uniq_opening_times_business_day").on(table.businessId, table.day)],
);

export type OpeningTimesRow = typeof openingTimes.$inferSelect;
export type OpeningDay = Omit<OpeningTimesRow, "id" | "businessId">;
