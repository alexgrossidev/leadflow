import { z } from "zod";
import dotenv from "dotenv";
import { existsSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { logger } from "#core/logger";

// Resolve this service's own .env from the package root (two levels up from
// src/config, and from dist/config once built) rather than process.cwd(), so the
// config loads correctly no matter where the process was started from.
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../");
const envPath = resolve(packageRoot, ".env");
if (existsSync(envPath)) {
  dotenv.config({ path: envPath, quiet: true });
}

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(5097),

  // Database (REDIS_* are read by @leadflow/shared)
  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().min(1),
  DB_NAME: z.string().min(1),

  // Facebook app + Graph API
  FB_APP_ID: z.string().min(1),
  FB_APP_SECRET: z.string().min(1),
  FB_VERIFY_TOKEN: z.string().min(1),
  FB_API_VERSION: z
    .string()
    .regex(/^v\d+\.\d+$/, "FB_API_VERSION must look like 'v22.0'")
    .default("v22.0"),
  // Overridable so the demo (and tests) can point the Graph client at a mock.
  FB_GRAPH_BASE_URL: z.url().default("https://graph.facebook.com"),
  // Must match the redirect URI registered in the Facebook app exactly.
  FB_REDIRECT_URI: z.url(),
  FB_OAUTH_SCOPES: z
    .string()
    .min(1)
    .default(
      "pages_show_list,pages_read_engagement,pages_manage_metadata,pages_manage_ads,leads_retrieval",
    ),
  // HMAC key for the OAuth `state` parameter (CSRF protection on the callback).
  OAUTH_STATE_SECRET: z
    .string()
    .min(32, "OAUTH_STATE_SECRET must be at least 32 characters"),

  // Google Forms: shared HMAC secret the relay signs submissions with.
  GOOGLE_FORMS_SECRET: z.string().min(1),
  // Hidden form field bots fill; any value on it marks the submission as spam.
  GOOGLE_HONEYPOT_FIELD: z.string().min(1).optional(),
  // Reject submissions older than this; also the TTL of the responseId dedupe key.
  GOOGLE_REPLAY_WINDOW_MS: z.coerce.number().int().positive().default(900_000),
  // Per-source (tenant + form) flood cap: max submissions per rate window.
  GOOGLE_RATE_LIMIT: z.coerce.number().int().positive().default(30),
  GOOGLE_RATE_WINDOW_MS: z.coerce.number().int().positive().default(60_000),

  // Delivery target: the gateway's internal lead intake.
  GATEWAY_URL: z.url(),
  // Shared service-to-service secret: sent to the gateway, required on /fb/connect.
  SERVICE_TOKEN: z
    .string()
    .min(16, "SERVICE_TOKEN must be at least 16 characters"),
});

export type Env = z.infer<typeof envSchema>;

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Fail fast at boot, naming every offending variable (values are never logged).
  logger.fatal(
    {
      issues: parsed.error.issues.map((i) => ({
        variable: i.path.join("."),
        message: i.message,
      })),
    },
    "Invalid environment configuration",
  );
  process.exit(1);
}

export const env: Env = parsed.data;
