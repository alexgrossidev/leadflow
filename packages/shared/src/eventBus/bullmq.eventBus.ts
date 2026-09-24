import type { QueueProvider, QueueWorker } from "../queue";
import { logger } from "../logger/logger";
import type { EventPayloadMap, serviceName } from "./event.types";
import type { EmitOptions, EventHandler, EventMeta, SubscribeOptions } from "./eventbus.types";

const EVENT_DEFAULT_ATTEMPTS = 3;
const EVENT_DEFAULT_CONCURRENCY = 5;

/**
 * Typed, service-addressed event bus built on the QueueProvider abstraction.
 *
 * - Each consuming service owns exactly one queue (named after the service), so
 *   a service needs a single worker regardless of how many events it handles.
 * - The event name travels as the job name; the worker dispatches on it.
 * - `EventPayloadMap` ties every event name to its payload type, so producers
 *   and consumers cannot disagree on a contract without a compile error.
 *
 * Failed events are retried with exponential backoff and then retained (bounded)
 * in the queue's failed set for inspection and manual replay.
 */
export class BullMQEventBus {
  private readonly workers = new Map<string, QueueWorker>();
  private readonly handlers = new Map<string, Map<string, EventHandler<unknown>>>();

  constructor(private readonly provider: QueueProvider) {}

  async emit<E extends keyof EventPayloadMap>(
    service: serviceName,
    eventName: E,
    payload: EventPayloadMap[E],
    opts: EmitOptions = {},
  ): Promise<string> {
    const jobId = await this.provider.enqueue(service, payload, {
      customJobName: eventName,
      ...(opts.jobId != null ? { jobId: opts.jobId } : {}),
      ...(opts.delay != null ? { delay: opts.delay } : {}),
      ...(opts.priority != null ? { priority: opts.priority } : {}),
      attempts: opts.attempts ?? EVENT_DEFAULT_ATTEMPTS,
      backoff: { type: "exponential", delay: 2_000 },
    });
    // Payloads are not logged — they can contain PII and credentials.
    logger.debug({ service, eventName, jobId }, "Event emitted");
    return jobId;
  }

  subscribe<E extends keyof EventPayloadMap>(
    service: serviceName,
    eventName: E,
    handler: EventHandler<EventPayloadMap[E]>,
    opts: SubscribeOptions = {},
  ): void {
    let serviceHandlers = this.handlers.get(service);
    if (!serviceHandlers) {
      serviceHandlers = new Map();
      this.handlers.set(service, serviceHandlers);
    }
    if (serviceHandlers.has(eventName)) {
      logger.warn({ service, eventName }, "Overwriting existing handler for event");
    }
    serviceHandlers.set(eventName, handler as EventHandler<unknown>);

    if (this.workers.has(service)) return;

    const prefix = `${service}:`;
    const worker = this.provider.process<unknown>(
      service,
      async (job) => {
        const name = job.name.startsWith(prefix) ? job.name.slice(prefix.length) : job.name;
        const dispatch = this.handlers.get(service)?.get(name);
        if (!dispatch) {
          logger.warn({ service, eventName: name, jobId: job.id }, "No handler registered for event");
          return;
        }
        const meta: EventMeta = {
          jobId: job.id,
          eventName: name,
          serviceName: service,
          attemptsMade: job.attemptsMade,
        };
        // Errors propagate so the queue applies retries/backoff.
        await dispatch(job.data, meta);
      },
      { concurrency: opts.concurrency ?? EVENT_DEFAULT_CONCURRENCY },
    );
    this.workers.set(service, worker);
  }

  /** Stops this bus's workers. Queue connections are owned by the provider. */
  async close(): Promise<void> {
    await Promise.all([...this.workers.values()].map((w) => w.close()));
    this.workers.clear();
  }
}
