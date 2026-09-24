import { defineConfig } from "drizzle-kit";

// Offline generation only: `npx drizzle-kit generate` diffs the table files
// against migrations/meta and writes plain SQL that the demo applies in order.
export default defineConfig({
  dialect: "mysql",
  schema: "./src/modules/**/*.table.ts",
  out: "./migrations",
  // Plain SQL files: drizzle's "--> statement-breakpoint" markers are not valid MySQL comments.
  breakpoints: false,
});
