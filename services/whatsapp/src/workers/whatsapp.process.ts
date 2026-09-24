import type { JobContext, WhatsappProcessPayload } from "@leadflow/shared";
import { logger } from "@leadflow/shared";
import type { MessageLogService } from "#modules/messageLogs/messageLog.service";
import type { WhatsappClient } from "#transport/whatsapp.client";
import {
  normalizeWhatsappError,
  RetriableWhatsappError,
  UnrecoverableWhatsappError,
} from "#transport/whatsapp.errors";

export interface ProcessorDeps {
  messageLogs: Pick<MessageLogService, "findById" | "markSent" | "markFailed" | "recordAttempt">;
  client: Pick<WhatsappClient, "send">;
  /** Called after a successful send; keeps a busy session from hitting the inactivity timeout. */
  onSent: (businessId: number, userId: number) => Promise<void>;
  maxAttempts: number;
}

/**
 * Sends one queued message. Terminal states are recorded in the message log;
 * transient failures are re-thrown so BullMQ retries with backoff.
 */
export function createWhatsappJobProcessor(deps: ProcessorDeps) {
  return async (job: JobContext<WhatsappProcessPayload>): Promise<void> => {
    const payload = job.data;
    const attempt = job.attemptsMade + 1;
    const ids = { idempotencyKey: payload.idempotencyKey, messageLogId: payload.messageLogId, attempt };

    const log = await deps.messageLogs.findById(payload.messageLogId);
    if (!log) {
      throw new UnrecoverableWhatsappError("Whatsapp message log not found", "MESSAGE_LOG_NOT_FOUND");
    }
    if (log.status !== "pending") {
      logger.info({ ...ids, status: log.status }, "Message already finished; skipping");
      return;
    }

    logger.info({ ...ids, automationId: payload.automationId, businessId: payload.businessId }, "Sending whatsapp message");

    let providerMessageId: string | undefined;
    try {
      ({ providerMessageId } = await deps.client.send(payload));
    } catch (error) {
      await handleFailure(deps, payload, error, attempt);
      return;
    }

    await deps.messageLogs.markSent(payload.messageLogId, providerMessageId);
    logger.info({ ...ids, providerMessageId }, "Whatsapp message sent");

    await deps.onSent(payload.businessId, payload.userId).catch((err: unknown) =>
      logger.warn({ ...ids, err }, "Could not record session activity after send"),
    );
  };
}

async function handleFailure(
  deps: ProcessorDeps,
  payload: WhatsappProcessPayload,
  error: unknown,
  attempt: number,
): Promise<void> {
  const normalized = normalizeWhatsappError(error);
  const ids = { idempotencyKey: payload.idempotencyKey, messageLogId: payload.messageLogId, attempt, errorCode: normalized.code };

  const retriesLeft = attempt < deps.maxAttempts;

  // Only WhatsApp-domain errors are terminal. Anything else (DB, Redis, a bug)
  // is re-thrown untouched so BullMQ retries it; the message is not failed.
  if (error instanceof UnrecoverableWhatsappError || (error instanceof RetriableWhatsappError && !retriesLeft)) {
    await deps.messageLogs.markFailed(payload.messageLogId, attempt, normalized);
    logger.error(ids, error instanceof UnrecoverableWhatsappError ? "Unrecoverable whatsapp failure" : "Whatsapp retries exhausted");
    return;
  }

  if (error instanceof RetriableWhatsappError) {
    // A failure to record the attempt must not suppress the retry.
    await deps.messageLogs
      .recordAttempt(payload.messageLogId, attempt, normalized)
      .catch((err: unknown) => logger.warn({ ...ids, err }, "Failed to record whatsapp attempt"));
    logger.warn(ids, "Transient whatsapp failure; BullMQ will retry");
  } else {
    logger.warn({ ...ids, err: error }, "Unexpected error while sending; BullMQ will retry");
  }
  throw error;
}
