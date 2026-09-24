import crypto from "crypto";
import { env } from "#config/env";
import { queue } from "#core/queue";
import { logger as defaultLogger, type Logger } from "#core/logger";
import { leadJobId, leadJobOptions } from "#core/jobs";
import { headerValue, safeEqual } from "#core/secrets";
import { JobNames, type TypedQueueClient } from "@leadflow/shared/jobs";
import {
  FacebookVerifyTokenMismatchError,
  InvalidFacebookSignatureError,
} from "./facebook.errors";
import {
  LeadgenChangeValueSchema,
  type FacebookLeadWebhookPayload,
} from "./facebook.schema";

type EnqueueQueue = Pick<TypedQueueClient, "enqueue">;

export interface FacebookServiceDeps {
  queue: EnqueueQueue;
  appSecret: string;
  verifyToken: string;
  logger: Logger;
}

export interface EnqueueSummary {
  enqueued: number;
  skipped: number;
}

export class FacebookService {
  private readonly queue: EnqueueQueue;
  private readonly appSecret: string;
  private readonly verifyToken: string;
  private readonly log: Logger;

  constructor(deps: Partial<FacebookServiceDeps> = {}) {
    this.queue = deps.queue ?? queue;
    this.appSecret = deps.appSecret ?? env.FB_APP_SECRET;
    this.verifyToken = deps.verifyToken ?? env.FB_VERIFY_TOKEN;
    this.log = deps.logger ?? defaultLogger;
  }

  /** Subscription handshake: echo the challenge only if the verify token matches. */
  verifyWebhook(mode: string, token: string, challenge: string): string {
    if (mode !== "subscribe" || !safeEqual(token, this.verifyToken)) {
      throw new FacebookVerifyTokenMismatchError();
    }
    return challenge;
  }

  /** Reject the request unless its body HMAC matches Facebook's signature header. */
  assertValidSignature(
    rawBody: Buffer | string | undefined,
    header: string | string[] | undefined,
  ): void {
    const signature = headerValue(header);
    if (!rawBody || !signature?.startsWith("sha256=")) {
      throw new InvalidFacebookSignatureError();
    }

    const expected =
      "sha256=" +
      crypto.createHmac("sha256", this.appSecret).update(rawBody).digest("hex");

    const received = Buffer.from(signature);
    const computed = Buffer.from(expected);
    if (
      received.length !== computed.length ||
      !crypto.timingSafeEqual(received, computed)
    ) {
      throw new InvalidFacebookSignatureError();
    }
  }

  /**
   * Fan each leadgen change out to its own idempotent job (jobId = lead_<id>)
   * so Facebook gets its ACK immediately and processing happens asynchronously.
   * Meta redelivers webhooks, so the same leadgen id arriving twice collapses
   * onto one job. If an enqueue throws, the request fails with 5xx and Meta
   * retries the whole batch; already-enqueued ids dedupe.
   */
  async enqueueLeads(
    payload: FacebookLeadWebhookPayload,
  ): Promise<EnqueueSummary> {
    const summary: EnqueueSummary = { enqueued: 0, skipped: 0 };

    for (const entry of payload.entry) {
      for (const change of entry.changes) {
        if (change.field !== "leadgen") {
          summary.skipped += 1;
          continue;
        }
        const parsed = LeadgenChangeValueSchema.safeParse(change.value);
        if (!parsed.success) {
          // Never fatal for the batch: the reconciliation sync re-covers the
          // page, and failing here would make Meta redeliver the good changes.
          this.log.error(
            { pageId: entry.id, issues: parsed.error.issues.length },
            "[Facebook] malformed leadgen change skipped",
          );
          summary.skipped += 1;
          continue;
        }

        const { leadgen_id, page_id, form_id, created_time } = parsed.data;
        await this.queue.enqueue(
          JobNames.FACEBOOK_LEAD_PROCESS,
          {
            leadgenId: leadgen_id,
            pageId: page_id,
            formId: form_id,
            createdTime: created_time,
          },
          leadJobOptions(leadJobId(JobNames.FACEBOOK_LEAD_PROCESS, leadgen_id)),
        );
        summary.enqueued += 1;
      }
    }

    return summary;
  }
}
