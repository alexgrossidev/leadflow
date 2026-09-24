import { z } from "zod";
import dotenv from "dotenv";

dotenv.config({ quiet: true });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.string().default("info"),
  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().min(1),
  DB_NAME: z.string().min(1),
  /** host:port of the gateway's LeadService, used to backfill new automations. */
  GATEWAY_GRPC_ADDR: z.string().min(1),
});

export type Env = z.infer<typeof envSchema>;

/**
 * Parsed lazily so that importing a module never exits the process; the
 * entrypoint calls this first and fails fast with a readable message.
 */
let cached: Env | null = null;

export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  cached = parsed.data;
  return cached;
}
