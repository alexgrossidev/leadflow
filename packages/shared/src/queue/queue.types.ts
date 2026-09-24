// ─── Queue Provider Abstraction ─────────────────────────────────────────────
// Swap BullMQ → Kafka / SQS / anything by implementing QueueProvider.

/** Keep the last `count` jobs and/or those younger than `age` seconds; `true` removes immediately. */
export type RetentionPolicy =
  | boolean
  | number
  | { count: number; age?: number }
  | { age: number; count?: number };

export interface EnqueueOptions {
  jobId?: string; // idempotency key
  delay?: number; // delay in ms before processing
  attempts?: number; // max retry attempts  (default: 3)
  backoff?: { type: "fixed" | "exponential"; delay: number };
  priority?: number; // lower = higher priority
  removeOnComplete?: RetentionPolicy; // default: keep last 1000
  removeOnFail?: RetentionPolicy; // default: keep last 5000 for inspection
  customJobName?: string; // for dynamic job naming (e.g. "send-email:welcome")
}

export interface RepeatOptions {
  every?: number; // interval in ms
  cron?: string; // cron expression (mutually exclusive with `every`)
  limit?: number; // max total executions (omit for unlimited)
}

export interface ScheduleOptions extends EnqueueOptions {
  repeat: RepeatOptions;
}

export interface JobContext<T = unknown> {
  id: string;
  name: string;
  data: T;
  attemptsMade: number;
}

export type JobHandler<T = unknown> = (job: JobContext<T>) => Promise<void>;

export interface ProcessOptions {
  concurrency?: number;
}

export interface QueueWorker {
  close(): Promise<void>;
}

export interface QueueProvider {
  enqueue<T>(jobName: string, data: T, opts?: EnqueueOptions): Promise<string>;

  bulkEnqueue<T>(
    jobName: string,
    dataArray: T[],
    opts?: EnqueueOptions,
  ): Promise<string[]>;

  schedule<T>(jobName: string, data: T, opts: ScheduleOptions): Promise<void>;

  unschedule(jobName: string, opts: RepeatOptions): Promise<void>;

  process<T>(
    jobName: string,
    handler: JobHandler<T>,
    opts?: ProcessOptions,
  ): QueueWorker;

  close(): Promise<void>;

  scheduleOnce<T>(name: string, data: T, opts: EnqueueOptions): Promise<string>;
}
