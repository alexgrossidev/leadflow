import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "src/**/__test__/**/*.test.ts",
      "scripts/**/__test__/**/*.test.ts",
    ],
    exclude: ["**/*.live.test.ts", "**/node_modules/**"],
    /** Satisfies the env schema at import time; no test may reach a real one. */
    env: {
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      SERVICE_TOKEN: "test-service-token",
    },
  },
});
