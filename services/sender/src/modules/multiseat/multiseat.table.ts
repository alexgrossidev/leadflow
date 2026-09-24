import { mysqlTable, int, boolean } from "drizzle-orm/mysql-core";

/** When enabled, a contact's messages go out from (and count against) the user it is assigned to. */
export const multiseatSettings = mysqlTable("multiseat_config", {
  businessId: int("business_id").primaryKey(),
  enabled: boolean("enabled").notNull(),
});
