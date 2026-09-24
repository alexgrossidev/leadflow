import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const src = (p: string) => resolve(root, "src", p);

// Mirrors the package.json "imports" map so tests resolve like the runtime.
export default defineConfig({
  resolve: {
    alias: {
      "#config": src("config"),
      "#core": src("core"),
      "#dispatchers": src("dispatchers"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/*.live.test.ts"],
  },
});
