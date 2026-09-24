import { toJobId, type EnqueueOptions, type JobContext } from "@leadflow/shared";
import type { JobName, JobPayloadMap } from "@leadflow/shared/jobs";

export interface QueuedJob {
  id: string;
  queue: JobName;
  /** What BullMQ would report as `job.name`: "<queue>:<customJobName>". */
  name: string;
  data: unknown;
  dueAt: number;
  opts: EnqueueOptions;
}

/**
 * Deterministic stand-in for the queue: jobs become due after their delay on
 * a virtual clock, and an add whose id already exists is ignored (as BullMQ
 * does while the job is retained).
 */
export class FakeQueue {
  readonly all: QueuedJob[] = [];
  readonly ignored: string[] = [];
  private pending: QueuedJob[] = [];
  private seq = 0;

  constructor(private readonly clock: () => Date) {}

  async enqueue<K extends JobName>(queue: K, data: JobPayloadMap[K], opts: EnqueueOptions = {}): Promise<string> {
    const id = opts.jobId != null ? toJobId(opts.jobId) : `auto-${++this.seq}`;
    if (this.all.some((job) => job.id === id)) {
      this.ignored.push(id);
      return id;
    }
    const job: QueuedJob = {
      id,
      queue,
      name: opts.customJobName ? `${queue}:${opts.customJobName}` : queue,
      data: structuredClone(data),
      dueAt: this.clock().getTime() + (opts.delay ?? 0),
      opts,
    };
    this.all.push(job);
    this.pending.push(job);
    return id;
  }

  /** Removes and returns the job that is due first. */
  next(): QueuedJob | undefined {
    this.pending.sort((a, b) => a.dueAt - b.dueAt);
    return this.pending.shift();
  }
}

export const toContext = <T>(job: QueuedJob, attemptsMade = 0): JobContext<T> => ({
  id: job.id,
  name: job.name,
  data: job.data as T,
  attemptsMade,
});
