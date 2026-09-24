import { db } from "#core/db";
import { and, eq, ne, sql } from "drizzle-orm";
import {
  NewWhatsappMessageLog,
  WhatsappMessageLog,
  whatsappMessageLogs,
} from "./messageLog.table";

export class MessageLogRepository {
  async findByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<WhatsappMessageLog | null> {
    const [log] = await db
      .select()
      .from(whatsappMessageLogs)
      .where(eq(whatsappMessageLogs.idempotencyKey, idempotencyKey))
      .limit(1);

    return log ?? null;
  }

  async findById(id: number): Promise<WhatsappMessageLog | null> {
    const [log] = await db
      .select()
      .from(whatsappMessageLogs)
      .where(eq(whatsappMessageLogs.id, id))
      .limit(1);

    return log ?? null;
  }

  async createPending(
    input: NewWhatsappMessageLog,
  ): Promise<WhatsappMessageLog> {
    const existing = await this.findByIdempotencyKey(input.idempotencyKey);
    if (existing) return existing;

    try {
      await db.insert(whatsappMessageLogs).values(input);
    } catch (error) {
      const raced = await this.findByIdempotencyKey(input.idempotencyKey);
      if (raced) return raced;
      throw error;
    }

    const created = await this.findByIdempotencyKey(input.idempotencyKey);
    if (!created) {
      throw new Error("Failed to create whatsapp message log");
    }

    return created;
  }

  async markQueued(id: number): Promise<void> {
    await db
      .update(whatsappMessageLogs)
      .set({ queuedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(whatsappMessageLogs.id, id));
  }

  async recordAttempt(
    id: number,
    attempts: number,
    error: { code?: string; message: string; payload?: unknown },
  ): Promise<void> {
    await db
      .update(whatsappMessageLogs)
      .set({
        attempts,
        errorCode: error.code,
        errorMessage: error.message,
        errorPayload: error.payload,
      })
      .where(and(eq(whatsappMessageLogs.id, id), ne(whatsappMessageLogs.status, "sent")));
  }

  async markSent(id: number, providerMessageId?: string): Promise<void> {
    await db
      .update(whatsappMessageLogs)
      .set({
        status: "sent",
        providerMessageId,
        sentAt: sql`CURRENT_TIMESTAMP`,
        errorCode: null,
        errorMessage: null,
        errorPayload: null,
      })
      .where(eq(whatsappMessageLogs.id, id));
  }

  async markFailed(
    id: number,
    attempts: number,
    error: { code?: string; message: string; payload?: unknown },
  ): Promise<void> {
    await db
      .update(whatsappMessageLogs)
      .set({
        status: "failed",
        attempts,
        errorCode: error.code,
        errorMessage: error.message,
        errorPayload: error.payload,
        failedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(and(eq(whatsappMessageLogs.id, id), ne(whatsappMessageLogs.status, "sent")));
  }
}

export type MessageLogStore = Pick<MessageLogRepository, keyof MessageLogRepository>;
