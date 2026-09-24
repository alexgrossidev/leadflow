import { z } from "zod";
import dotenv from "dotenv";

dotenv.config({ quiet: true });

const booleanFlag = z
  .enum(["true", "false", "1", "0"])
  .default("false")
  .transform((v) => v === "true" || v === "1");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.string().default("info"),
  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().min(1),
  DB_NAME: z.string().min(1),
  SMTP_HOST: z.string().min(1),
  SMTP_PORT: z.coerce.number().int().positive(),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  /** Envelope and header sender, e.g. `Leadflow <no-reply@leadflow.test>`. */
  SMTP_FROM: z.string().min(1),
  /** true = implicit TLS (port 465); false = plain or STARTTLS. */
  SMTP_SECURE: booleanFlag,
  /**
   * off: no deliverability checks; basic: offline typo/disposable checks;
   * full: basic plus MX/SPF/DMARC lookups (needs outbound DNS).
   */
  EMAIL_CHECKS: z.enum(["off", "basic", "full"]).default("basic"),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

/** Parsed on first use so importing a module never exits the process. */
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
