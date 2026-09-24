import { toJobId, type EnqueueOptions } from "@leadflow/shared";
import type { JobName, JobPayloadMap } from "@leadflow/shared/jobs";

export interface RecordedJob<K extends JobName = JobName> {
  id: string;
  name: K;
  data: JobPayloadMap[K];
  opts: EnqueueOptions;
}

/**
 * In-memory stand-in for the queue that keeps the BullMQ behaviour the code
 * relies on: an add whose job id is already stored is silently ignored.
 */
export class FakeQueue {
  readonly jobs: RecordedJob[] = [];
  readonly ignored: string[] = [];
  private seq = 0;

  async enqueue<K extends JobName>(name: K, data: JobPayloadMap[K], opts: EnqueueOptions = {}): Promise<string> {
    const id = opts.jobId != null ? toJobId(opts.jobId) : `auto-${++this.seq}`;
    if (this.jobs.some((job) => job.id === id)) {
      this.ignored.push(id);
      return id;
    }
    this.jobs.push({ id, name, data, opts } as RecordedJob);
    return id;
  }

  /** Removes and returns every pending job with the given name, in enqueue order. */
  drain<K extends JobName>(name: K): RecordedJob<K>[] {
    const taken = this.jobs.filter((job): job is RecordedJob<K> => job.name === name && !this.done.has(job.id));
    taken.forEach((job) => this.done.add(job.id));
    return taken;
  }

  of<K extends JobName>(name: K): RecordedJob<K>[] {
    return this.jobs.filter((job): job is RecordedJob<K> => job.name === name);
  }

  private readonly done = new Set<string>();
}

export const ctx = <K extends JobName>(job: RecordedJob<K>) => ({
  id: job.id,
  name: job.name,
  data: job.data,
  attemptsMade: 0,
});
