import dotenv from "dotenv";
import { z } from "zod";

dotenv.config({ quiet: true });

const secret = (name: string) =>
  z.string().min(16, `${name} must be at least 16 characters (generate one with: openssl rand -hex 32)`);

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3012),
  /** Bind address. Inside a container this must be 0.0.0.0 to be reachable. */
  HOST: z.string().min(1).default("0.0.0.0"),

  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().min(1),
  DB_NAME: z.string().min(1),

  /** Shared service-to-service secret, required as `x-service-token` on /sessions routes. */
  SERVICE_TOKEN: secret("SERVICE_TOKEN"),

  /** Base URL of the wppconnect-server transport (or the dev fake). */
  WHATSAPP_SERVER_URL: z.url(),
  /**
   * wppconnect-server's SECRET_KEY. Upstream puts it in URL paths
   * (`/api/:session/:secret/generate-token`), so transport URLs must never be logged.
   */
  WA_TRANSPORT_SECRET_KEY: secret("WA_TRANSPORT_SECRET_KEY"),
  /**
   * Authenticates webhook callbacks. Stock wppconnect-server cannot send custom
   * headers, so the transport is configured with
   * WEBHOOK_URL=http://<this-service>:3012/sessions/callback/<WA_WEBHOOK_SECRET>.
   */
  WA_WEBHOOK_SECRET: secret("WA_WEBHOOK_SECRET"),

  WHATSAPP_QUEUE_ATTEMPTS: z.coerce.number().int().positive().default(5),
  WHATSAPP_RETRY_DELAY_MS: z.coerce.number().int().positive().default(5000),
  WHATSAPP_WORKER_CONCURRENCY: z.coerce.number().int().positive().default(5),
  WHATSAPP_SEND_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  WHATSAPP_SESSION_HEALTH_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),
  WHATSAPP_MAX_CONCURRENT_SESSIONS: z.coerce.number().int().positive().default(20),
  WHATSAPP_SESSION_MAX_RECONNECT_ATTEMPTS: z.coerce.number().int().positive().default(5),
  WHATSAPP_SESSION_INACTIVITY_TIMEOUT_MS: z.coerce.number().int().positive().default(1_800_000),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (parsed.success) return parsed.data;

  // Report field names and reasons only: values may be secrets.
  const problems = parsed.error.issues
    .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
    .join("\n");
  throw new Error(`Invalid whatsapp service environment:\n${problems}`);
}

export const env = loadEnv();
