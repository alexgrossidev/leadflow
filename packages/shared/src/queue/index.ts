export type {
  QueueProvider,
  QueueWorker,
  EnqueueOptions,
  ScheduleOptions,
  RepeatOptions,
  ProcessOptions,
  JobHandler,
  JobContext,
} from "../queue/queue.types";

import { BullMQProvider } from "./bullmq.provider";
export { toJobId } from "./bullmq.provider";
import type { QueueProvider } from "./queue.types";

let instance: QueueProvider | null = null;

/** Returns the singleton QueueProvider. Provider choice is internal. */
export function getQueueProvider(): QueueProvider {
  if (!instance) {
    instance = new BullMQProvider();
  }
  return instance;
}
