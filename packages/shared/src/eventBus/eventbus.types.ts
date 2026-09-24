export interface EmitOptions {
  /**
   * Deduplication / idempotency key.
   * BullMQ will upsert — a second emit with the same jobId is a no-op if the
   * first job is still waiting or active.
   */
  jobId?: string;

  /** Milliseconds to delay before the job becomes visible to workers. */
  delay?: number;

  /** Job priority — lower numbers = higher priority. Defaults to none. */
  priority?: number;

  /**
   * Max delivery attempts before the job is left in the failed set.
   * Defaults to EVENT_DEFAULT_ATTEMPTS (3).
   */
  attempts?: number;
}

export interface SubscribeOptions {
  /**
   * How many jobs this worker processes concurrently.
   * Defaults to EVENT_DEFAULT_CONCURRENCY (5).
   */
  concurrency?: number;
}

export type EventHandler<T> = (payload: T, meta: EventMeta) => Promise<void>;

export interface EventMeta {
  jobId: string;
  eventName: string;
  serviceName: string;
  attemptsMade: number;
}
