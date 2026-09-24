import { createHash } from "crypto";
import type { senderDeliverToWhatsappPayload, WhatsappProcessPayload } from "@leadflow/shared";
import { MessageLogRepository, type MessageLogStore } from "./messageLog.repo";
import type { NewWhatsappMessageLog } from "./messageLog.table";

export class MessageLogService {
  constructor(private readonly repo: MessageLogStore = new MessageLogRepository()) {}

  /**
   * The producer's key when present (the sender always sends one), otherwise a
   * key derived from the same inputs so redeliveries still collapse to one row.
   */
  buildIdempotencyKey(payload: senderDeliverToWhatsappPayload): string {
    if (payload.idempotencyKey) return payload.idempotencyKey;

    const contentHash = createHash("sha256")
      .update(
        JSON.stringify({
          body: payload.content.body,
          attachments: payload.content.attachments ?? [],
        }),
      )
      .digest("hex")
      .slice(0, 16);

    return [
      "whatsapp",
      payload.automationId ?? "manual",
      payload.targetId ?? payload.recipientId ?? "unknown-target",
      payload.recipientPhone,
      contentHash,
    ].join(":");
  }

  async createPending(payload: senderDeliverToWhatsappPayload) {
    const idempotencyKey = this.buildIdempotencyKey(payload);
    const insert: NewWhatsappMessageLog = {
      idempotencyKey,
      status: "pending",
      userId: payload.userId,
      businessId: payload.businessId,
      recipientPhone: payload.recipientPhone,
      createdAt: new Date(),
    };

    if (payload.automationId !== undefined) insert.automationId = payload.automationId;
    if (payload.targetId !== undefined) insert.targetId = payload.targetId;
    if (payload.recipientId !== undefined) insert.recipientId = payload.recipientId;
    if (payload.recipientType !== undefined) insert.recipientType = payload.recipientType;
    if (payload.payloadRef !== undefined) insert.payloadRef = payload.payloadRef;

    return this.repo.createPending(insert);
  }

  toProcessPayload(
    payload: senderDeliverToWhatsappPayload,
    messageLogId: number,
  ): WhatsappProcessPayload {
    return {
      ...payload,
      messageLogId,
      idempotencyKey: this.buildIdempotencyKey(payload),
    };
  }

  findById(id: number) {
    return this.repo.findById(id);
  }

  markQueued(id: number) {
    return this.repo.markQueued(id);
  }

  recordAttempt(
    id: number,
    attempts: number,
    error: { code?: string; message: string; payload?: unknown },
  ) {
    return this.repo.recordAttempt(id, attempts, error);
  }

  markSent(id: number, providerMessageId?: string) {
    return this.repo.markSent(id, providerMessageId);
  }

  markFailed(
    id: number,
    attempts: number,
    error: { code?: string; message: string; payload?: unknown },
  ) {
    return this.repo.markFailed(id, attempts, error);
  }
}

export const messageLogs = new MessageLogService();
