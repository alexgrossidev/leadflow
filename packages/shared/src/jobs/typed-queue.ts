import type {
  EnqueueOptions,
  ScheduleOptions,
  RepeatOptions,
  ProcessOptions,
  JobHandler,
  QueueWorker,
} from "../queue/queue.types";
import { getQueueProvider } from "../queue";
import type { JobPayloadMap, JobName } from "./job.registry";

// ─── Type-Safe Queue Client ────────────────────────────────────────────────
// Wraps the internal QueueProvider and enforces the JobPayloadMap contracts.
// API routes enqueue, workers process — both get full type safety.
// Services never touch BullMQ (or whatever runs underneath) directly.

export class TypedQueueClient {
  async enqueue<K extends JobName>(
    name: K,
    data: JobPayloadMap[K],
    opts?: EnqueueOptions,
  ): Promise<string> {
    return getQueueProvider().enqueue(name, data, opts);
  }

  async bulkEnqueue<K extends JobName>(
    name: K,
    dataArray: JobPayloadMap[K][],
    opts?: EnqueueOptions,
  ): Promise<string[]> {
    return getQueueProvider().bulkEnqueue(name, dataArray, opts);
  }

  async schedule<K extends JobName>(
    name: K,
    data: JobPayloadMap[K],
    opts: ScheduleOptions,
  ): Promise<void> {
    return getQueueProvider().schedule(name, data, opts);
  }

  async unschedule<K extends JobName>(
    name: K,
    opts: RepeatOptions,
  ): Promise<void> {
    return getQueueProvider().unschedule(name, opts);
  }

  process<K extends JobName>(
    name: K,
    handler: JobHandler<JobPayloadMap[K]>,
    opts?: ProcessOptions,
  ): QueueWorker {
    return getQueueProvider().process(name, handler, opts);
  }

  scheduleOnce<K extends JobName>(
    name: K,
    data: JobPayloadMap[K],
    opts: EnqueueOptions,
  ): Promise<string> {
    return getQueueProvider().scheduleOnce(name, data, opts);
  }

  async close(): Promise<void> {
    return getQueueProvider().close();
  }
}
