import { z } from "zod";
import dotenv from "dotenv";
import { existsSync } from "fs";
import { resolve } from "path";

const envPath = resolve(process.cwd(), ".env");
if (existsSync(envPath)) {
  dotenv.config({ path: envPath, quiet: true });
}

const csv = z
  .string()
  .default("")
  .transform((value) =>
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3020),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),

  /** Shared service-to-service secret, both inbound (x-service-token) and outbound to the gateway. */
  SERVICE_TOKEN: z.string().min(1),

  DB_HOST: z.string().default("localhost"),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_USER: z.string().default("root"),
  DB_PASSWORD: z.string().default(""),
  DB_NAME: z.string().default("agents"),

  /**
   * Which LLM vendor runs. `fake` is a deterministic, offline responder for the
   * docker demo and local development without an API key.
   */
  LLM_PROVIDER: z.enum(["anthropic", "gemini", "fake"]).default("anthropic"),

  // Each key is optional here and enforced by the provider that needs it: an
  // Anthropic deployment must not require a Gemini key, and vice versa.
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_MODEL: z.string().min(1).default("claude-opus-5"),
  ANTHROPIC_EFFORT: z
    .enum(["low", "medium", "high", "xhigh", "max"])
    .default("high"),
  /**
   * Opt into server-side refusal fallbacks (`fallbacks: "default"`): a request
   * declined by a safety classifier is re-run on Anthropic's recommended
   * fallback model inside the same call. Turn off for models or platforms that
   * do not support the beta.
   */
  ANTHROPIC_REFUSAL_FALLBACK: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),

  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().min(1).default("gemini-3.5-flash-lite"),

  /** Background runs executing at once; the rest wait in the in-process queue. */
  AGENT_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(4),
  /** Waiting runs beyond this are refused with 503 rather than queued without bound. */
  AGENT_QUEUE_LIMIT: z.coerce.number().int().min(1).default(1000),

  /** Gateway action endpoints: the agent's only way to reach a channel. */
  GATEWAY_URL: z.url().default("http://localhost:3000"),

  /**
   * URL prefixes a `send_whatsapp_attachment` file_url must start with.
   * `{businessId}` is replaced with the run's tenant, so a prefix like
   * `https://files.example.com/tenants/{businessId}/` confines each tenant to
   * its own storage. Empty disables the attachment tool.
   */
  ATTACHMENT_URL_PREFIXES: csv.refine(
    (prefixes) =>
      prefixes.every(
        (prefix) => prefix.startsWith("https://") && prefix.endsWith("/"),
      ),
    // The trailing slash stops https://files.example.com matching
    // https://files.example.com.attacker.net.
    "Each prefix must start with https:// and end with /",
  ),
});

export type Env = z.output<typeof envSchema>;

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Thrown, not logged: this runs before anything else is initialised, and an
  // uncaught error at import is the clearest possible fail-fast.
  throw new Error(
    `Invalid environment variables:\n${z.prettifyError(parsed.error)}`,
  );
}

export const env: Env = parsed.data;
