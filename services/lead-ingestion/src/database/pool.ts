import mysql from "mysql2/promise";
import { env } from "#config/env";
import { drizzle } from "drizzle-orm/mysql2";
import { logger } from "#core/logger";

/**
 * Connection resilience tuning.
 *
 * `IDLE_TIMEOUT_MS` MUST remain below the MySQL server's `wait_timeout`. The
 * pool reaps connections that have been idle this long, closing them cleanly
 * (FIN) before the server force-kills them. This is what prevents the pool from
 * ever handing out a server-closed socket after a quiet period — the original
 * cause of PROTOCOL_CONNECTION_LOST / ETIMEDOUT on the first query after idle.
 */
export const DB_IDLE_TIMEOUT_MS = 60_000;
export const DB_CONNECT_TIMEOUT_MS = 10_000;

/**
 * Process-wide MySQL pool. mysql2 opens connections lazily, so importing this
 * module does not touch the network.
 */
export const pool = mysql.createPool({
  host: env.DB_HOST,
  port: env.DB_PORT,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
  connectionLimit: 10,
  waitForConnections: true,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  // Reap idle connections before the server's wait_timeout can kill them.
  idleTimeout: DB_IDLE_TIMEOUT_MS,
  maxIdle: 10,
  connectTimeout: DB_CONNECT_TIMEOUT_MS,
});

/**
 * A connection killed by the server while idle surfaces as an asynchronous
 * 'error' on the connection object. With no listener Node treats it as an
 * unhandled error and crashes the process. mysql2 already removes the dead
 * connection from the pool; we only need to observe and log it so a stale
 * socket dropped during inactivity can never take the service down.
 */
pool.on("connection", (connection) => {
  connection.on("error", (error: NodeJS.ErrnoException) => {
    logger.warn(
      { code: error.code, message: error.message },
      "Idle MySQL connection dropped; pool will replace it",
    );
  });
});

export const db = drizzle(pool);

/** Ping one pooled connection; used by the readiness endpoint. */
export const checkMainConnection = async (): Promise<boolean> => {
  try {
    const connection = await pool.getConnection();
    try {
      await connection.ping();
    } finally {
      connection.release();
    }
    return true;
  } catch (err) {
    logger.error(
      { code: (err as NodeJS.ErrnoException)?.code },
      "Database ping failed",
    );
    return false;
  }
};

/**
 * Gracefully drains and closes the pool. Call once during shutdown.
 */
export const closePool = async (): Promise<void> => {
  try {
    await pool.end();
    logger.info("MySQL pool closed");
  } catch (err) {
    logger.error(
      { code: (err as NodeJS.ErrnoException)?.code },
      "Error closing MySQL pool",
    );
  }
};
