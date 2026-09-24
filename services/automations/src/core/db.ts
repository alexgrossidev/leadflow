import mysql from "mysql2/promise";
import { drizzle } from "drizzle-orm/mysql2";
import { getEnv } from "../config/env";

const env = getEnv();

export const pool = mysql.createPool({
  host: env.DB_HOST,
  port: env.DB_PORT,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
  connectionLimit: 10,
  waitForConnections: true,
  enableKeepAlive: true,
});

export const db = drizzle(pool);

/** The handle a transaction callback receives; repos accept it to join a caller's tx. */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
