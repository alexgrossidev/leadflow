import { createClient } from "redis";
import { logger } from "../logger/logger";
import { getRedisEnv } from "./env";

export type RedisClient = ReturnType<typeof createClient>;

const MAX_RECONNECT_ATTEMPTS = 10;

let client: RedisClient | null = null;
let connecting: Promise<unknown> | null = null;

function createRedisClient(): RedisClient {
  const env = getRedisEnv();
  const instance = createClient({
    ...(env.REDIS_USERNAME ? { username: env.REDIS_USERNAME } : {}),
    ...(env.REDIS_PASSWORD ? { password: env.REDIS_PASSWORD } : {}),
    socket: {
      host: env.REDIS_HOST,
      port: env.REDIS_PORT,
      reconnectStrategy: (retries) => {
        if (retries > MAX_RECONNECT_ATTEMPTS) {
          logger.error("Redis max reconnect attempts reached");
          return new Error("Max reconnect retries reached");
        }
        const delay = Math.min(500 * 2 ** retries, 30_000);
        logger.warn({ delay, attempt: retries }, "Redis reconnecting");
        return delay;
      },
    },
  });

  instance.on("error", (err) => logger.error({ err }, "Redis error"));
  instance.on("ready", () => logger.info("Redis ready"));
  instance.on("end", () => logger.warn("Redis connection closed"));
  return instance;
}

/**
 * Process-wide Redis client, created and connected on first call. A failed
 * initial connect resets the singleton so the next call retries from scratch.
 */
export function getClient(): RedisClient {
  if (!client) {
    const instance = createRedisClient();
    client = instance;
    connecting = instance.connect().catch((err: unknown) => {
      logger.error({ err }, "Redis initial connect failed");
      client = null;
      connecting = null;
      throw err;
    });
  }
  return client;
}

/** Resolves once the shared client is connected; rejects if the connect fails. */
export async function waitForRedis(): Promise<void> {
  getClient();
  await connecting;
}

export async function closeRedis(): Promise<void> {
  if (client?.isOpen) await client.quit();
  client = null;
  connecting = null;
}
