import { defineConfig } from "vitest/config";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const root = dirname(fileURLToPath(import.meta.url));
const src = (p: string) => resolve(root, "src", p);

// Mirror the package.json "imports" subpath map so tests resolve the same way
// the runtime does.
const subpathAliases = {
  "#core": src("core"),
  "#dispatchers": src("dispatchers"),
  "#modules": src("modules_inbound"),
  "#config": src("config"),
  "#workers": src("workers"),
  "#database": src("database"),
};

export default defineConfig({
  resolve: { alias: subpathAliases },
  test: {
    environment: "node",
    // Tests live beside the module they cover. Live tests need real
    // infrastructure and credentials and are run by hand.
    include: ["src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/*.live.test.ts"],
    // Placeholder values so importing #config/env passes validation. No Redis
    // or MySQL settings: both clients connect lazily and tests inject fakes.
    env: {
      LOG_LEVEL: "silent",
      DB_HOST: "localhost",
      DB_USER: "test",
      DB_PASSWORD: "test",
      DB_NAME: "test",
      FB_APP_ID: "test-fb-app",
      FB_APP_SECRET: "test-fb-secret",
      FB_VERIFY_TOKEN: "test-verify",
      FB_REDIRECT_URI: "http://localhost:5097/fb/auth",
      OAUTH_STATE_SECRET: "test-oauth-state-secret-at-least-32-chars",
      GOOGLE_FORMS_SECRET: "test-google-secret",
      GATEWAY_URL: "http://localhost:3000",
      SERVICE_TOKEN: "test-service-token-0123456789",
    },
  },
});
