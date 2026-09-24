import { z } from "zod";

const booleanFromString = z
  .enum(["true", "false"])
  .default("false")
  .transform((value) => value === "true");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("production"),
  LOG_LEVEL: z.string().default("info"),

  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().min(1),
  DB_NAME: z.string().min(1),

  // Any S3-compatible store: Backblaze B2 in production, MinIO in the demo.
  S3_ENDPOINT: z.url(),
  S3_REGION: z.string().min(1),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(1),
  S3_BUCKET: z.string().min(1),
  // MinIO needs path-style URLs (http://host/bucket/key); B2 and AWS accept both.
  S3_FORCE_PATH_STYLE: booleanFromString,

  GATEWAY_GRPC_ADDR: z.string().min(1),
  GRPC_DEADLINE_MS: z.coerce.number().int().positive().default(30_000),

  // Upper bound for spreadsheet uploads, which are parsed in memory (see
  // dispatchers/parsers/xlsx.ts). CSV is streamed and is not subject to it.
  IMPORT_MAX_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(20 * 1024 * 1024),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/**
 * Validates process.env once. Throws with every offending variable listed so a
 * misconfigured container fails at boot rather than on the first job. Secret
 * values are never included in the message, only variable names and reasons.
 */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment variables:\n${problems}`);
  }
  cached = parsed.data;
  return cached;
}

/** The validated environment; `loadEnv()` must have run first (see app.ts). */
export function env(): Env {
  if (!cached) {
    throw new Error("env() called before loadEnv()");
  }
  return cached;
}
