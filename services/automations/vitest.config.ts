import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const packages = resolve(root, "../../packages");

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
    exclude: ["**/*.live.test.ts", "**/node_modules/**"],
    env: { LOG_LEVEL: "silent" },
  },
  resolve: {
    // Workspace packages are consumed from source, as `tsx --conditions=development` does.
    alias: [
      { find: /^@leadflow\/shared$/, replacement: resolve(packages, "shared/src/index.ts") },
      { find: /^@leadflow\/shared\/(.+)$/, replacement: resolve(packages, "shared/src/$1/index.ts") },
      { find: /^@leadflow\/rpc$/, replacement: resolve(packages, "rpc/src/index.ts") },
    ],
  },
});
