import { logger } from "#core/logger";
import { queue } from "#core/queue";
import { JobNames, type TypedQueueClient } from "@leadflow/shared/jobs";
import { FacebookTokenFailureRepository } from "./tokenFailure.repo";

/** Only the queue surface this service needs — narrowed for easy faking. */
type NotifyQueue = Pick<TypedQueueClient, "enqueue">;

export interface TokenFailureDeps {
  repo: FacebookTokenFailureRepository;
  queue: NotifyQueue;
  logger: typeof logger;
}

export interface TokenFailureInput {
  userId: number;
  businessId: number;
  pageId?: string | null;
  reason: string;
  error?: unknown;
}

/** Retry the revoked-token event a few times; durable in Redis once enqueued. */
const NOTIFY_OPTS = {
  attempts: 5,
  backoff: { type: "exponential" as const, delay: 5000 },
} as const;

/**
 * Owns the unrecoverable-token path: persist the dead-letter row first (durable,
 * never lost), then emit FACEBOOK_TOKEN_REVOKED for the owning application to
 * prompt the user to reconnect (no service in this repository consumes it yet).
 * The DB write is the source of truth: if the notify enqueue fails we leave the
 * row un-notified and the next heal attempt re-emits it.
 */
export class TokenFailureService {
  private readonly repo: FacebookTokenFailureRepository;
  private readonly queue: NotifyQueue;
  private readonly log: typeof logger;

  constructor(deps: Partial<TokenFailureDeps> = {}) {
    this.repo = deps.repo ?? new FacebookTokenFailureRepository();
    this.queue = deps.queue ?? queue;
    this.log = deps.logger ?? logger;
  }

  async recordAndNotify(input: TokenFailureInput): Promise<void> {
    await this.repo.recordFailure({
      userId: input.userId,
      businessId: input.businessId,
      pageId: input.pageId ?? null,
      reason: input.reason,
      lastError: this.describe(input.error),
    });

    const active = await this.repo.findActive(input.userId, input.businessId);
    if (!active || active.notifiedAt) return; // already notified; don't spam.

    try {
      await this.queue.enqueue(
        JobNames.FACEBOOK_TOKEN_REVOKED,
        {
          userId: input.userId,
          businessId: input.businessId,
          pageId: input.pageId ?? undefined,
          reason: input.reason,
        },
        {
          jobId: `fb_token_revoked_${input.userId}_${input.businessId}`,
          ...NOTIFY_OPTS,
        },
      );
      await this.repo.markNotified(input.userId, input.businessId);
    } catch (err) {
      // Persisted already — a later heal attempt re-emits. Never throw past here.
      this.log.error(
        { err, userId: input.userId, businessId: input.businessId },
        "Failed to emit FACEBOOK_TOKEN_REVOKED; will retry on next heal",
      );
    }
  }

  /** Close the dead-letter row once the account heals / reconnects. */
  async markResolved(userId: number, businessId: number): Promise<void> {
    await this.repo.markResolved(userId, businessId);
  }

  /** Error messages here are already redacted (ExternalHttpError / DatabaseError). */
  private describe(error: unknown): string | null {
    if (!error) return null;
    if (error instanceof Error) {
      const cause = error.cause instanceof Error ? error.cause.message : null;
      return (cause ? `${error.message} | cause: ${cause}` : error.message).slice(0, 2000);
    }
    return String(error).slice(0, 2000);
  }
}
