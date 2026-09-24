import mysql from "mysql2/promise";
import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import type { Env } from "#config/env";

let pool: mysql.Pool | undefined;
let database: MySql2Database | undefined;

/** Creates the pool; called once from app.ts after env validation. */
export function initDatabase(config: Env): MySql2Database {
  pool = mysql.createPool({
    host: config.DB_HOST,
    port: config.DB_PORT,
    user: config.DB_USER,
    password: config.DB_PASSWORD,
    database: config.DB_NAME,
    connectionLimit: 10,
    waitForConnections: true,
    enableKeepAlive: true,
  });
  database = drizzle(pool);
  return database;
}

export function getDb(): MySql2Database {
  if (!database) {
    throw new Error("Database used before initDatabase()");
  }
  return database;
}

/** Round-trips a connection so boot fails fast on bad credentials or host. */
export async function pingDatabase(): Promise<void> {
  if (!pool) throw new Error("Database used before initDatabase()");
  const connection = await pool.getConnection();
  try {
    await connection.ping();
  } finally {
    connection.release();
  }
}

export async function closeDatabase(): Promise<void> {
  await pool?.end();
  pool = undefined;
  database = undefined;
}
