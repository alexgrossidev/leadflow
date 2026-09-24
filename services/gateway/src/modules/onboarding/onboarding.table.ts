import { mysqlTable, int, boolean, json, unique } from "drizzle-orm/mysql-core";

export const onboarding = mysqlTable(
  "onboarding",
  {
    id: int("id").primaryKey().autoincrement(),
    userId: int("user_id").notNull(),
    tempId: int("temp_id"),
    completed: boolean("completed").default(false),
    data: json("data"),
  },
  (table) => [unique("uq_onboarding_user").on(table.userId)],
);

export type Onboarding = typeof onboarding.$inferSelect;
export type NewOnboarding = typeof onboarding.$inferInsert;
