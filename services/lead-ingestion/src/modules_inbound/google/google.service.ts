import crypto from "crypto";
import { env } from "#config/env";
import { queue } from "#core/queue";
import { logger as defaultLogger, type Logger } from "#core/logger";
import { leadJobId, leadJobOptions } from "#core/jobs";
import { JobNames, type TypedQueueClient } from "@leadflow/shared/jobs";
import { normalizeKey } from "#dispatchers/lead/normalise.utils";
import { parseFieldDataLead } from "#dispatchers/lead/normalise";
import { InvalidGoogleSignatureError } from "./google.errors";
import { isValidGoogleSignature } from "./google.signature";
import { redisSeenStore, type SeenStore } from "./google.dedupe";
import { redisRateLimiter, type RateLimiter } from "./google.ratelimit";
import { scoreLead } from "./google.score";
import type { GoogleLeadWebhookPayload } from "./google.schema";

/** Just the queue surface the service needs, so tests can inject a fake. */
type QueueLike = Pick<TypedQueueClient, "enqueue">;

/** How far ahead of our clock a submission may claim to be (relay clock drift). */
const MAX_CLOCK_SKEW_MS = 2 * 60 * 1000;

/** Why a submission was dropped at the edge; used for observability only. */
export type DropReason =
  | "honeypot"
  | "stale"
  | "future_timestamp"
  | "content"
  | "rate_limited"
  | "duplicate";

export type CaptureOutcome =
  | { status: "enqueued" }
  | { status: "dropped"; reason: DropReason };

export interface GoogleServiceDeps {
  secret: string;
  queue: QueueLike;
  seenStore: SeenStore;
  rateLimiter: RateLimiter;
  honeypotField?: string;
  replayWindowMs: number;
  rateLimit: number;
  rateWindowMs: number;
  logger: Logger;
  now: () => number;
}

export class GoogleService {
  private readonly secret: string;
  private readonly queue: QueueLike;
  private readonly seenStore: SeenStore;
  private readonly rateLimiter: RateLimiter;
  private readonly honeypotField?: string;
  private readonly replayWindowMs: number;
  private readonly rateLimit: number;
  private readonly rateWindowMs: number;
  private readonly log: Logger;
  private readonly now: () => number;

  constructor(deps: Partial<GoogleServiceDeps> = {}) {
    this.secret = deps.secret ?? env.GOOGLE_FORMS_SECRET;
    this.queue = deps.queue ?? queue;
    this.seenStore = deps.seenStore ?? redisSeenStore;
    this.rateLimiter = deps.rateLimiter ?? redisRateLimiter;
    this.honeypotField =
      "honeypotField" in deps ? deps.honeypotField : env.GOOGLE_HONEYPOT_FIELD;
    this.replayWindowMs = deps.replayWindowMs ?? env.GOOGLE_REPLAY_WINDOW_MS;
    this.rateLimit = deps.rateLimit ?? env.GOOGLE_RATE_LIMIT;
    this.rateWindowMs = deps.rateWindowMs ?? env.GOOGLE_RATE_WINDOW_MS;
    this.log = deps.logger ?? defaultLogger;
    this.now = deps.now ?? Date.now;
  }

  /** Reject the request unless its body HMAC matches the shared-secret signature. */
  assertValidSignature(
    rawBody: Buffer | string | undefined,
    header: string | string[] | undefined,
  ): void {
    if (!isValidGoogleSignature(rawBody, header, this.secret)) {
      throw new InvalidGoogleSignatureError();
    }
  }

  /**
   * Antispam edge gate, cheapest check first: honeypot → timestamp window →
   * content → rate → duplicate, then enqueue. A dropped submission is logged
   * and swallowed (the caller still ACKs 200 so a bot never learns which check
   * caught it). Redis faults fail OPEN: a real lead is never dropped because
   * of infrastructure, and the BullMQ jobId plus the lead_delivery guard still
   * stop a duplicate downstream.
   *
   * Ordering matters for the duplicate check: the id is recorded as seen only
   * AFTER the enqueue succeeds. Recording it first would turn a failed enqueue
   * (5xx, relay retries) into a silently dropped "duplicate". Two concurrent
   * deliveries of the same id can both pass `isSeen`; they collapse onto one
   * job because the jobId is derived from the responseId.
   */
  async captureLead(payload: GoogleLeadWebhookPayload): Promise<CaptureOutcome> {
    const reason = this.screen(payload);
    if (reason) return this.dropped(payload.responseId, reason);

    const verdict = scoreLead(
      parseFieldDataLead({ id: payload.responseId, field_data: payload.answers }),
    );
    if (verdict.drop) {
      return this.dropped(payload.responseId, "content", {
        reasons: verdict.reasons,
        hash: this.answersHash(payload),
      });
    }

    if (!(await this.withinRate(payload))) {
      return this.dropped(payload.responseId, "rate_limited");
    }

    if (await this.alreadySeen(payload.responseId)) {
      return this.dropped(payload.responseId, "duplicate");
    }

    // Throws on failure: the caller answers 5xx and the relay retries.
    await this.enqueueLead(payload, verdict.flags);
    await this.recordSeen(payload.responseId);
    return { status: "enqueued" };
  }

  /** Short content fingerprint so an audited drop can be reconciled without storing PII. */
  private answersHash(payload: GoogleLeadWebhookPayload): string {
    return crypto
      .createHash("sha256")
      .update(JSON.stringify(payload.answers))
      .digest("hex")
      .slice(0, 16);
  }

  /** Synchronous checks that need no I/O: honeypot field, then timestamp window. */
  private screen(payload: GoogleLeadWebhookPayload): DropReason | null {
    if (this.honeypotField && this.honeypotTripped(payload, this.honeypotField)) {
      return "honeypot";
    }
    const age = this.now() - payload.createdTime;
    if (age > this.replayWindowMs) return "stale";
    // A far-future timestamp would otherwise stretch the replay window at will.
    if (age < -MAX_CLOCK_SKEW_MS) return "future_timestamp";
    return null;
  }

  private honeypotTripped(
    payload: GoogleLeadWebhookPayload,
    honeypotField: string,
  ): boolean {
    const target = normalizeKey(honeypotField);
    return payload.answers.some(
      (a) =>
        normalizeKey(a.name) === target &&
        a.values.some((v) => v.trim() !== ""),
    );
  }

  /** Per-source flood cap; on any Redis fault fail open (allow the submission). */
  private async withinRate(
    payload: GoogleLeadWebhookPayload,
  ): Promise<boolean> {
    const key = `${payload.userId}:${payload.businessId}:${payload.formId ?? "-"}`;
    try {
      return await this.rateLimiter.allow(
        key,
        this.rateLimit,
        this.rateWindowMs,
      );
    } catch (err) {
      this.log.warn(
        { err, responseId: payload.responseId },
        "[Google] rate limiter unavailable; failing open",
      );
      return true;
    }
  }

  /** Redis dedupe read; on any Redis fault fail open (treat as unseen). */
  private async alreadySeen(responseId: string): Promise<boolean> {
    try {
      return await this.seenStore.isSeen(responseId);
    } catch (err) {
      this.log.warn(
        { err, responseId },
        "[Google] dedupe store unavailable; failing open",
      );
      return false;
    }
  }

  /** Best effort: a failure only weakens edge dedupe; the jobId still dedupes. */
  private async recordSeen(responseId: string): Promise<void> {
    try {
      await this.seenStore.markSeen(responseId, this.replayWindowMs);
    } catch (err) {
      this.log.warn(
        { err, responseId },
        "[Google] could not record responseId as seen",
      );
    }
  }

  private dropped(
    responseId: string,
    reason: DropReason,
    meta?: Record<string, unknown>,
  ): CaptureOutcome {
    this.log.info(
      { responseId, reason, ...meta },
      "[Google] submission dropped at edge",
    );
    return { status: "dropped", reason };
  }

  /**
   * Enqueue one idempotent capture job (jobId = glead_<responseId>) so we ACK
   * the relay immediately and normalise + deliver asynchronously.
   */
  async enqueueLead(
    payload: GoogleLeadWebhookPayload,
    flags: string[] = [],
  ): Promise<void> {
    await this.queue.enqueue(
      JobNames.GOOGLE_LEAD_PROCESS,
      {
        userId: payload.userId,
        businessId: payload.businessId,
        formId: payload.formId,
        responseId: payload.responseId,
        createdTime: payload.createdTime,
        answers: payload.answers,
        ...(flags.length > 0 ? { flags } : {}),
      },
      leadJobOptions(
        leadJobId(JobNames.GOOGLE_LEAD_PROCESS, payload.responseId),
      ),
    );
  }
}
