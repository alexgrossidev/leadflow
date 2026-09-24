import { env } from "#config/env";
import { eventEmitter } from "#core/eventEmitter";
import { queue } from "#core/queue";
import { messageLogs } from "#modules/messageLogs/messageLog.service";
import { eventNames, serviceNames } from "@leadflow/shared";
import { NUMBER_ADDED } from "./dispatchers/whatsappNumber/number.ADDED";
import { NUMBER_REMOVED } from "./dispatchers/whatsappNumber/number.REMOVED";
import { createWhatsappRequestHandler } from "./workers/whatsapp.receiver";

/**
 * All inbound events share this service's single event-bus queue; the worker's
 * concurrency is fixed by the first subscription.
 */
export function subscribeToEvents(): void {
  eventEmitter.subscribe(
    serviceNames.WHATSAPP,
    eventNames.WHATSAPP_REQUEST_CREATED,
    createWhatsappRequestHandler({
      messageLogs,
      queue,
      attempts: env.WHATSAPP_QUEUE_ATTEMPTS,
      retryDelayMs: env.WHATSAPP_RETRY_DELAY_MS,
    }),
    { concurrency: env.WHATSAPP_WORKER_CONCURRENCY },
  );
  eventEmitter.subscribe(serviceNames.WHATSAPP, eventNames.WHATSAPP_NUMBER_ADDED, NUMBER_ADDED);
  eventEmitter.subscribe(serviceNames.WHATSAPP, eventNames.WHATSAPP_NUMBER_REMOVED, NUMBER_REMOVED);
}
