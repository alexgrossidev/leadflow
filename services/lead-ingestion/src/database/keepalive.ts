import { EventEmitter } from "node:events";
import type { Pool } from "mysql2/promise";
import { logger } from "#core/logger";
import { pool } from "./pool";

export type DbHealthState = "healthy" | "unhealthy";

export interface KeepAliveOptions {
  /** Heartbeat cadence. Keep below the MySQL server `wait_timeout`. */
  intervalMs: number;
  /** Consecutive failed pings before the DB is reported unhealthy. */
  maxConsecutiveFailures: number;
}

const DEFAULT_OPTIONS: KeepAliveOptions = {
  intervalMs: 30_000,
  maxConsecutiveFailures: 3,
};

/**
 * Periodically issues a lightweight ping against the pool to keep a session
 * warm and detect loss of connectivity early.
 *
 * MySQL closes idle sessions once `wait_timeout` elapses. During quiet periods
 * (no inbound webhooks / jobs) the service can sit idle long enough for pooled
 * connections to be reaped server-side, so the next real query fails with
 * PROTOCOL_CONNECTION_LOST / ETIMEDOUT. A heartbeat at an interval below
 * `wait_timeout` keeps a session active and surfaces outages as events instead
 * of as user-facing query failures.
 *
 * Emits:
 *  - "healthy"   when connectivity is (re)established after being unhealthy
 *  - "unhealthy" after `maxConsecutiveFailures` consecutive ping failures
 */
export class DatabaseKeepAlive extends EventEmitter {
  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;
  private stopped = true;
  private consecutiveFailures = 0;
  private state: DbHealthState = "healthy";

  constructor(
    private readonly pool: Pool,
    private readonly options: KeepAliveOptions = DEFAULT_OPTIONS,
  ) {
    super();
  }

  get healthy(): boolean {
    return this.state === "healthy";
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.scheduleNext();
    logger.info(
      { intervalMs: this.options.intervalMs },
      "Database keep-alive started",
    );
  }

  /** Stops the heartbeat and waits for any in-flight ping to settle. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    while (this.inFlight) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    logger.info("Database keep-alive stopped");
  }

  private scheduleNext(): void {
    if (this.stopped) return;
    // ±10% jitter avoids synchronised herd pings across replicas.
    const base = this.options.intervalMs;
    const jitter = base * 0.1 * (Math.random() * 2 - 1);
    this.timer = setTimeout(() => void this.beat(), base + jitter);
    // The heartbeat must not, by itself, keep the process alive.
    this.timer.unref();
  }

  private async beat(): Promise<void> {
    if (this.stopped) return;
    this.inFlight = true;
    try {
      const connection = await this.pool.getConnection();
      try {
        await connection.ping();
      } finally {
        connection.release();
      }
      this.onSuccess();
    } catch (error) {
      this.onFailure(error);
    } finally {
      this.inFlight = false;
      this.scheduleNext();
    }
  }

  private onSuccess(): void {
    this.consecutiveFailures = 0;
    if (this.state === "unhealthy") {
      this.state = "healthy";
      logger.info("Database connectivity restored");
      this.emit("healthy");
    }
  }

  private onFailure(error: unknown): void {
    this.consecutiveFailures += 1;
    const err = error as NodeJS.ErrnoException;
    logger.warn(
      {
        code: err?.code,
        message: err?.message,
        consecutiveFailures: this.consecutiveFailures,
      },
      "Database keep-alive ping failed",
    );

    if (
      this.state === "healthy" &&
      this.consecutiveFailures >= this.options.maxConsecutiveFailures
    ) {
      this.state = "unhealthy";
      logger.error(
        { consecutiveFailures: this.consecutiveFailures },
        "Database marked unhealthy",
      );
      this.emit("unhealthy");
    }
  }
}

/** Process-wide singleton bound to the main pool. */
export const databaseKeepAlive = new DatabaseKeepAlive(pool, DEFAULT_OPTIONS);
