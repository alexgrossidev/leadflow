import { getQueueProvider } from "../queue";
import { BullMQEventBus } from "./bullmq.eventBus";

export * from "./event.types";
export * from "./eventbus.types";
export * from "./event.contracts";
export { BullMQEventBus } from "./bullmq.eventBus";

let instance: BullMQEventBus | null = null;

/** Process-wide event bus, sharing the process-wide queue provider. */
export function getEventEmitter(): BullMQEventBus {
  instance ??= new BullMQEventBus(getQueueProvider());
  return instance;
}
