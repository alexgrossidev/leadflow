import { db } from "#core/db";
import { and, count, eq, inArray, sql } from "drizzle-orm";
import {
  NewSessionRow,
  SessionRow,
  SessionStatus,
  whatsappSessions,
} from "./session.table";

/** Statuses that occupy a transport slot and count against the session cap. */
export const CAPACITY_STATUSES = ["connecting", "qr_ready", "qr_scanned", "connected"] as const;

/**
 * Every state transition is a conditional UPDATE, so concurrent webhooks and
 * replicas cannot move a session backwards (e.g. a late qrcode webhook
 * downgrading a connected session). Methods that callers branch on return
 * whether the row actually changed.
 */
export class SessionRepository {
  async findByBusinessAndUser(businessId: number, userId: number): Promise<SessionRow | null> {
    const [session] = await db
      .select()
      .from(whatsappSessions)
      .where(and(eq(whatsappSessions.businessId, businessId), eq(whatsappSessions.userId, userId)))
      .limit(1);

    return session ?? null;
  }

  async create(input: NewSessionRow): Promise<SessionRow> {
    await db.insert(whatsappSessions).values(input);

    const created = await this.findByBusinessAndUser(input.businessId, input.userId);
    if (!created) throw new Error("Failed to create whatsapp session");
    return created;
  }

  /** Set `status`, optionally only when the current status is one of `onlyFrom`. */
  async updateStatus(id: number, status: SessionStatus, onlyFrom?: readonly SessionStatus[]): Promise<boolean> {
    const [result] = await db
      .update(whatsappSessions)
      .set({ status })
      .where(onlyFrom ? and(eq(whatsappSessions.id, id), inArray(whatsappSessions.status, [...onlyFrom])) : eq(whatsappSessions.id, id));
    return result.affectedRows > 0;
  }

  /**
   * Store a fresh QR. "connected" and "closed" are excluded so a stale qrcode
   * webhook cannot downgrade them; "disconnected"/"failed" are allowed because
   * a reconnect legitimately produces a new QR.
   */
  async updateQr(id: number, qrCode: string, qrExpiresAt: Date): Promise<void> {
    await db
      .update(whatsappSessions)
      .set({ qrCode, qrExpiresAt, status: "qr_ready" })
      .where(
        and(
          eq(whatsappSessions.id, id),
          inArray(whatsappSessions.status, ["connecting", "qr_ready", "qr_scanned", "disconnected", "failed"]),
        ),
      );
  }

  /** Reset a row for a fresh connection attempt. */
  async resetToConnecting(id: number): Promise<void> {
    await db
      .update(whatsappSessions)
      .set({ status: "connecting", qrCode: null, qrExpiresAt: null, connectedAt: null, disconnectedAt: null })
      .where(eq(whatsappSessions.id, id));
  }

  /** Clear the QR once it has been scanned; only from pre-connected states. */
  async clearQr(id: number, status: SessionStatus): Promise<void> {
    await db
      .update(whatsappSessions)
      .set({ qrCode: null, qrExpiresAt: null, status })
      .where(
        and(eq(whatsappSessions.id, id), inArray(whatsappSessions.status, ["connecting", "qr_ready", "qr_scanned"])),
      );
  }

  /**
   * Promote to connected, only from pre-connected states: disconnected, failed
   * and closed stay put until someone explicitly re-initiates the session.
   */
  async setConnected(id: number): Promise<void> {
    await db
      .update(whatsappSessions)
      .set({ status: "connected", connectedAt: sql`CURRENT_TIMESTAMP`, qrCode: null, qrExpiresAt: null })
      .where(
        and(eq(whatsappSessions.id, id), inArray(whatsappSessions.status, ["connecting", "qr_ready", "qr_scanned"])),
      );
  }

  /**
   * Mark a live session disconnected. Returns false when it was not live:
   * wppconnect fires several disconnect webhooks for one event (e.g.
   * disconnectedMobile then browserClose within ~50 ms), and closing a session
   * deliberately also triggers them. This atomic compare-and-set lets exactly
   * one webhook, on any replica, react to a real disconnect.
   */
  async setDisconnected(id: number): Promise<boolean> {
    const [result] = await db
      .update(whatsappSessions)
      .set({ status: "disconnected", disconnectedAt: sql`CURRENT_TIMESTAMP` })
      .where(and(eq(whatsappSessions.id, id), inArray(whatsappSessions.status, [...CAPACITY_STATUSES])));
    return result.affectedRows > 0;
  }

  async countActive(): Promise<number> {
    const [result] = await db
      .select({ value: count() })
      .from(whatsappSessions)
      .where(inArray(whatsappSessions.status, [...CAPACITY_STATUSES]));

    return result?.value ?? 0;
  }
}

/** The persistence surface SessionService depends on (implemented in-memory by tests). */
export type SessionStore = Pick<SessionRepository, keyof SessionRepository>;
