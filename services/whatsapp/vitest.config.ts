import { defineConfig } from "vitest/config";
import { fileURLToPath } from "url";
import { resolve, dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = (path: string) => resolve(__dirname, "src", path);

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["dist/**", "node_modules/**", "**/*.live.test.ts"],
    // Placeholder values so src/config/env.ts validates; tests inject real
    // collaborators and never reach MySQL, Redis or a WhatsApp transport.
    env: {
      NODE_ENV: "test",
      LOG_LEVEL: "silent",
      DB_HOST: "127.0.0.1",
      DB_USER: "test",
      DB_PASSWORD: "test",
      DB_NAME: "whatsapp_test",
      SERVICE_TOKEN: "test-service-token-0123456789",
      WHATSAPP_SERVER_URL: "http://127.0.0.1:1",
      WA_TRANSPORT_SECRET_KEY: "test-transport-secret-0123456789",
      WA_WEBHOOK_SECRET: "test-webhook-secret-0123456789",
    },
  },
  resolve: {
    alias: [
      { find: /^#config\/(.*)$/, replacement: src("config/$1.ts") },
      { find: /^#core\/(.*)$/, replacement: src("core/$1.ts") },
      { find: /^#transport\/(.*)$/, replacement: src("transport/$1.ts") },
      { find: /^#modules\/(.*)$/, replacement: src("modules/$1.ts") },
      { find: /^#workers\/(.*)$/, replacement: src("workers/$1.ts") },
      { find: /^@leadflow\/shared\/(.*)$/, replacement: resolve(__dirname, "../../packages/shared/src/$1/index.ts") },
      { find: /^@leadflow\/shared$/, replacement: resolve(__dirname, "../../packages/shared/src/index.ts") },
    ],
  },
});
