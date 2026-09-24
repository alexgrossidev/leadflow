import { Queue, Worker, type ConnectionOptions, type JobsOptions } from "bullmq";
import { logger } from "../logger/logger";
import { getRedisEnv } from "../redis/env";
import type {
  QueueProvider,
  QueueWorker,
  EnqueueOptions,
  ScheduleOptions,
  RepeatOptions,
  ProcessOptions,
  JobHandler,
  JobContext,
} from "./queue.types";

/** Bounded retention so completed/failed jobs can be inspected without growing Redis forever. */
const DEFAULT_REMOVE_ON_COMPLETE = { count: 1_000 };
const DEFAULT_REMOVE_ON_FAIL = { count: 5_000 };
const DEFAULT_BACKOFF = { type: "exponential", delay: 5_000 } as const;

/**
 * BullMQ reserves ":" in custom job ids (it is its key separator), so callers
 * can build ids from natural keys like `whatsapp:42:7` and we normalise here,
 * in one place, instead of every producer having to know the rule.
 */
export function toJobId(id: string): string {
  return id.replace(/:/g, "_");
}

function connectionFromEnv(): ConnectionOptions {
  const env = getRedisEnv();
  return {
    host: env.REDIS_HOST,
    port: env.REDIS_PORT,
    ...(env.REDIS_USERNAME ? { username: env.REDIS_USERNAME } : {}),
    ...(env.REDIS_PASSWORD ? { password: env.REDIS_PASSWORD } : {}),
    maxRetriesPerRequest: null, // required by BullMQ workers
    retryStrategy: (times: number) => Math.min(times * 50, 2_000),
  };
}

function jobOptions(opts: EnqueueOptions = {}): JobsOptions {
  return {
    ...(opts.jobId != null ? { jobId: toJobId(opts.jobId) } : {}),
    ...(opts.delay != null ? { delay: opts.delay } : {}),
    ...(opts.priority != null ? { priority: opts.priority } : {}),
    attempts: opts.attempts ?? 3,
    backoff: opts.backoff ?? DEFAULT_BACKOFF,
    removeOnComplete: opts.removeOnComplete ?? DEFAULT_REMOVE_ON_COMPLETE,
    removeOnFail: opts.removeOnFail ?? DEFAULT_REMOVE_ON_FAIL,
  };
}

/** `customJobName` lets one queue carry several steps; workers route on `ctx.name`. */
function jobName(queueName: string, opts?: EnqueueOptions): string {
  return opts?.customJobName ? `${queueName}:${opts.customJobName}` : queueName;
}

export class BullMQProvider implements QueueProvider {
  private readonly queues = new Map<string, Queue>();
  private workers: Worker[] = [];
  private connection: ConnectionOptions | null = null;

  constructor(private readonly connectionFactory: () => ConnectionOptions = connectionFromEnv) {}

  // ── Produce ───────────────────────────────────────────────────
  // Payloads are never logged: they carry customer PII, OAuth codes and
  // mailbox credentials. Log the job identity only.

  async enqueue<T>(queueName: string, data: T, opts?: EnqueueOptions): Promise<string> {
    const job = await this.queue(queueName).add(jobName(queueName, opts), data, jobOptions(opts));
    logger.debug({ queue: queueName, name: job.name, jobId: job.id }, "Job enqueued");
    return job.id!;
  }

  async bulkEnqueue<T>(queueName: string, dataArray: T[], opts?: EnqueueOptions): Promise<string[]> {
    const name = jobName(queueName, opts);
    const jobs = await this.queue(queueName).addBulk(
      dataArray.map((data, index) => ({
        name,
        data,
        opts: jobOptions({ ...opts, ...(opts?.jobId != null ? { jobId: `${opts.jobId}-${index}` } : {}) }),
      })),
    );
    logger.debug({ queue: queueName, count: jobs.length }, "Bulk jobs enqueued");
    return jobs.map((job) => job.id!);
  }

  async scheduleOnce<T>(queueName: string, data: T, opts: EnqueueOptions): Promise<string> {
    return this.enqueue(queueName, data, opts);
  }

  // ── Consume ───────────────────────────────────────────────────

  process<T>(queueName: string, handler: JobHandler<T>, opts: ProcessOptions = {}): QueueWorker {
    const worker = new Worker<T>(
      queueName,
      async (job) => {
        const ctx: JobContext<T> = {
          id: job.id!,
          name: job.name,
          data: job.data,
          attemptsMade: job.attemptsMade,
        };
        await handler(ctx);
      },
      {
        connection: this.getConnection(),
        lockDuration: 60_000,
        stalledInterval: 30_000,
        maxStalledCount: 2,
        concurrency: opts.concurrency ?? 1,
      },
    );

    worker.on("failed", (job, err) =>
      logger.error({ queue: queueName, name: job?.name, jobId: job?.id, attempt: job?.attemptsMade, err: err.message }, "Job failed"),
    );
    worker.on("error", (err) => logger.error({ queue: queueName, err }, "Worker connection error"));

    this.workers.push(worker);
    return { close: () => worker.close() };
  }

  // ── Schedule (repeatable) ─────────────────────────────────────

  async schedule<T>(queueName: string, data: T, opts: ScheduleOptions): Promise<void> {
    const { repeat } = opts;
    // Job schedulers are upserted by id, so calling this on every boot is idempotent.
    await this.queue(queueName).upsertJobScheduler(
      toJobId(opts.jobId ?? queueName),
      {
        ...(repeat.every != null ? { every: repeat.every } : {}),
        ...(repeat.cron != null ? { pattern: repeat.cron } : {}),
        ...(repeat.limit != null ? { limit: repeat.limit } : {}),
      },
      { name: jobName(queueName, opts), data, opts: { attempts: opts.attempts ?? 3, backoff: opts.backoff ?? DEFAULT_BACKOFF } },
    );
    logger.info({ queue: queueName, every: repeat.every, cron: repeat.cron }, "Job scheduler upserted");
  }

  async unschedule(queueName: string, opts: RepeatOptions & { jobId?: string }): Promise<void> {
    const removed = await this.queue(queueName).removeJobScheduler(toJobId(opts.jobId ?? queueName));
    logger.info({ queue: queueName, removed }, "Job scheduler removed");
  }

  // ── Lifecycle ─────────────────────────────────────────────────

  async close(): Promise<void> {
    await Promise.all([
      ...this.workers.map((w) => w.close()),
      ...[...this.queues.values()].map((q) => q.close()),
    ]);
    this.queues.clear();
    this.workers = [];
  }

  // ── Internal ──────────────────────────────────────────────────

  private getConnection(): ConnectionOptions {
    this.connection ??= this.connectionFactory();
    return this.connection;
  }

  private queue(name: string): Queue {
    let queue = this.queues.get(name);
    if (!queue) {
      queue = new Queue(name, { connection: this.getConnection() });
      this.queues.set(name, queue);
    }
    return queue;
  }
}
