import { z } from "zod";

const redisEnvSchema = z.object({
  REDIS_HOST: z.string().min(1).default("localhost"),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_USERNAME: z.string().optional(),
  REDIS_PASSWORD: z.string().optional(),
});

export type RedisEnv = z.infer<typeof redisEnvSchema>;

let cached: RedisEnv | null = null;

/**
 * Parsed lazily on first use rather than at import time, so importing anything
 * from `@leadflow/shared` (types, the logger, job names) never requires Redis
 * config — unit tests and tooling can load the package without it.
 */
export function getRedisEnv(): RedisEnv {
  if (cached) return cached;
  const parsed = redisEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Invalid Redis environment: ${parsed.error.message}`);
  }
  cached = parsed.data;
  return cached;
}
