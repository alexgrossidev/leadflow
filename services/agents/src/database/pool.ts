import mysql from "mysql2/promise";
import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import type { Env } from "#config/env";
import { logger } from "#core/logger";

const DB_IDLE_TIMEOUT_MS = 60_000;
const DB_CONNECT_TIMEOUT_MS = 10_000;

export interface Database {
  db: MySql2Database;
  /** True when a connection can be checked out and pinged. */
  ping(): Promise<boolean>;
  /** Drains and closes the pool. Call once during shutdown. */
  close(): Promise<void>;
}

/** Creates the pool lazily: nothing connects until the first query. */
export const createDatabase = (
  config: Pick<Env, "DB_HOST" | "DB_PORT" | "DB_USER" | "DB_PASSWORD" | "DB_NAME">,
): Database => {
  const pool = mysql.createPool({
    host: config.DB_HOST,
    port: config.DB_PORT,
    user: config.DB_USER,
    password: config.DB_PASSWORD,
    database: config.DB_NAME,
    connectionLimit: 10,
    waitForConnections: true,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    idleTimeout: DB_IDLE_TIMEOUT_MS,
    maxIdle: 10,
    connectTimeout: DB_CONNECT_TIMEOUT_MS,
  });

  pool.on("connection", (connection) => {
    connection.on("error", (error: NodeJS.ErrnoException) => {
      logger.warn(
        { code: error.code },
        "Idle MySQL connection dropped; pool will replace it",
      );
    });
  });

  return {
    db: drizzle(pool),
    ping: async () => {
      try {
        const connection = await pool.getConnection();
        await connection.ping();
        connection.release();
        return true;
      } catch (error) {
        logger.error({ err: error }, "Database connection failed");
        return false;
      }
    },
    close: async () => {
      try {
        await pool.end();
        logger.info("MySQL pool closed");
      } catch (error) {
        logger.error({ err: error }, "Error closing MySQL pool");
      }
    },
  };
};
