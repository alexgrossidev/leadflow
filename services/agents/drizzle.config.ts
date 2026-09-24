import { defineConfig } from "drizzle-kit";

/**
 * Used only to generate SQL (`npm run db:generate`), which works offline from
 * the table definitions. The demo applies migrations/*.sql in lexical order to
 * an empty MySQL 8 database.
 */
export default defineConfig({
  dialect: "mysql",
  schema: "./src/modules/**/*.table.ts",
  out: "./migrations",
});
