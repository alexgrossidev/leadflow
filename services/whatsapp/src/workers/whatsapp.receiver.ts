import type { EventMeta, senderDeliverToWhatsappPayload, TypedQueueClient } from "@leadflow/shared";
import { JobNames, logger } from "@leadflow/shared";
import type { MessageLogService } from "#modules/messageLogs/messageLog.service";

export interface RequestHandlerDeps {
  messageLogs: Pick<MessageLogService, "createPending" | "toProcessPayload" | "markQueued">;
  queue: Pick<TypedQueueClient, "enqueue">;
  attempts: number;
  retryDelayMs: number;
}

/**
 * Handles `whatsapp.message.created` from the sender: persist a pending log row
 * (deduplicated on the idempotency key), then enqueue the actual send.
 *
 * The job id is the producer's idempotency key as-is. Keys contain ":", which
 * BullMQ rejects in custom ids, but the queue provider normalises every id
 * through toJobId(); the log row keeps the original key so it still matches
 * what the sender computes.
 */
export function createWhatsappRequestHandler(deps: RequestHandlerDeps) {
  return async (payload: senderDeliverToWhatsappPayload, meta: Pick<EventMeta, "jobId">): Promise<void> => {
    const log = await deps.messageLogs.createPending(payload);

    if (log.status !== "pending") {
      logger.info(
        { idempotencyKey: log.idempotencyKey, messageLogId: log.id, status: log.status },
        "Duplicate whatsapp request for a finished message; skipping",
      );
      return;
    }

    const processPayload = deps.messageLogs.toProcessPayload(payload, log.id);

    await deps.queue.enqueue(JobNames.WHATSAPP_PROCESS, processPayload, {
      jobId: processPayload.idempotencyKey,
      attempts: deps.attempts,
      backoff: { type: "exponential", delay: deps.retryDelayMs },
    });
    await deps.messageLogs.markQueued(log.id);

    logger.info(
      {
        sourceJobId: meta.jobId,
        idempotencyKey: processPayload.idempotencyKey,
        messageLogId: log.id,
        automationId: processPayload.automationId,
        businessId: processPayload.businessId,
      },
      "Whatsapp request accepted and queued",
    );
  };
}
