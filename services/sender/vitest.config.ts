import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const src = (p: string) => resolve(root, "src", p);
const packages = resolve(root, "../../packages");

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
    exclude: ["**/*.live.test.ts", "**/node_modules/**"],
    env: { LOG_LEVEL: "silent" },
  },
  resolve: {
    // Mirrors the package.json "imports" map, and consumes workspace packages from source.
    alias: [
      { find: /^#core\/(.+)$/, replacement: src("core/$1") },
      { find: /^#config\/(.+)$/, replacement: src("config/$1") },
      { find: /^#dispatchers\/(.+)$/, replacement: src("dispatchers/$1") },
      { find: /^#modules\/(.+)$/, replacement: src("modules/$1") },
      { find: /^#workers\/(.+)$/, replacement: src("workers/$1") },
      { find: /^@leadflow\/shared$/, replacement: resolve(packages, "shared/src/index.ts") },
      { find: /^@leadflow\/shared\/(.+)$/, replacement: resolve(packages, "shared/src/$1/index.ts") },
    ],
  },
});
