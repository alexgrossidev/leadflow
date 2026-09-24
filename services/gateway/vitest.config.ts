import { defineConfig } from "vitest/config";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/*.live.test.ts"],
    // Placeholder configuration so modules that read env at import time load
    // in tests. Nothing connects: the database and Redis layers are mocked.
    env: {
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      JWT_SECRET: "test-jwt-secret-that-is-at-least-32-chars",
      SERVICE_TOKEN: "test-service-token-that-is-at-least-32-chars",
      DB_HOST: "localhost",
      DB_USER: "test",
      DB_PASSWORD: "test",
      DB_NAME: "test",
      S3_ENDPOINT: "http://localhost:9000",
      S3_REGION: "us-east-1",
      S3_ACCESS_KEY_ID: "test",
      S3_SECRET_ACCESS_KEY: "test",
    },
  },
  resolve: {
    alias: [
      { find: /^#core\/(.+)/, replacement: path.resolve(__dirname, "src/core/$1") },
      { find: /^#database\/(.+)/, replacement: path.resolve(__dirname, "src/database/$1") },
      { find: /^#modules\/(.+)/, replacement: path.resolve(__dirname, "src/modules/$1") },
      { find: /^#config\/(.+)/, replacement: path.resolve(__dirname, "src/config/$1") },
      { find: /^#comms\/(.+)/, replacement: path.resolve(__dirname, "src/comms/$1") },
    ],
  },
});
