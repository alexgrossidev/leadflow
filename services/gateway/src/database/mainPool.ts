import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { env } from "#config/env";
import { logger } from "#core/logger";

// Ping every 4 minutes — well under any cloud DB idle timeout (typically 5–10 min)
const KEEPALIVE_INTERVAL_MS = 4 * 60 * 1000;

export const mainPool = mysql.createPool({
  host: env.DB_HOST,
  port: env.DB_PORT,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
  connectionLimit: 10,
  waitForConnections: true,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
});

export const mainDb = drizzle(mainPool);

export type Database = typeof mainDb;
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

/**
 * Anything that can run a query: the pool-backed database or an open
 * transaction. Repositories accept one (defaulting to `mainDb`) so a service
 * can make several repository calls atomic by passing its `tx` through.
 */
export type DbExecutor = Database | Transaction;

/** Fails boot when the database is unreachable or the credentials are wrong. */
export async function pingDatabase(): Promise<void> {
  const connection = await mainPool.getConnection();
  try {
    await connection.ping();
  } finally {
    connection.release();
  }
}

/**
 * drizzle wraps driver errors in a DrizzleQueryError whose `cause` carries the
 * mysql2 error, so the MySQL error code can sit on either object.
 */
export function isDuplicateKeyError(error: unknown): boolean {
  const codeOf = (value: unknown) =>
    typeof value === "object" && value !== null && "code" in value
      ? (value as { code: unknown }).code
      : undefined;
  const cause =
    typeof error === "object" && error !== null && "cause" in error
      ? (error as { cause: unknown }).cause
      : undefined;
  return codeOf(error) === "ER_DUP_ENTRY" || codeOf(cause) === "ER_DUP_ENTRY";
}

let keepaliveTimer: NodeJS.Timeout | null = null;

export function startPoolKeepalive(): void {
  keepaliveTimer = setInterval(() => {
    mainPool.query("SELECT 1").catch((err: unknown) => {
      logger.warn(
        { err },
        "Pool keepalive ping failed; the pool reconnects on the next query",
      );
    });
  }, KEEPALIVE_INTERVAL_MS);

  keepaliveTimer.unref();
}

export function stopPoolKeepalive(): void {
  if (keepaliveTimer) {
    clearInterval(keepaliveTimer);
    keepaliveTimer = null;
  }
}
