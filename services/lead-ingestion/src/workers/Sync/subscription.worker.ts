import { env } from "#config/env";
import { logger } from "#core/logger";
import { queue } from "#core/queue";
import { isRetryableError } from "#core/retry";
import {
  JobNames,
  type FacebookCheckSubscriptionPayload,
} from "@leadflow/shared/jobs";
import type { QueueWorker } from "@leadflow/shared/queue";
import {
  checkSubscriptionAPI,
  subscribeToWebHookAPI,
} from "../../modules_inbound/fbToken/fbToken.API";
import { FacebookTokenRepository } from "../../modules_inbound/fbToken/fbToken.repo";
import {
  FbTokenFatalError,
  FbTokenRetryableError,
} from "../../modules_inbound/fbToken/fbToken.errors";
import { TokenFailureService } from "../../modules_inbound/fbToken/tokenFailure.service";
import { toUpsert } from "#dispatchers/token/token.logic";
import { runWithTerminalHandling } from "../terminal";

/** Must match the `attempts` the scheduler is created with (token.dispatcher.ts). */
const MAX_ATTEMPTS = 5;

const repo = new FacebookTokenRepository();
const failures = new TokenFailureService();

/**
 * Confirm our app is still subscribed to the page's leadgen webhooks and
 * resubscribe if not. A page admin can remove the app at any time, after which
 * webhooks stop arriving without any error on our side.
 */
async function checkSubscription(
  userId: number,
  businessId: number,
): Promise<void> {
  const state = await repo.findByAccount(userId, businessId);
  if (!state?.token || !state.fbPageId || state.tokenType !== "page") {
    // Disconnected, or a reconnect is mid-flight; the next run re-checks.
    logger.warn({ userId, businessId }, "Subscription check skipped: account not connected");
    return;
  }

  const check = await checkSubscriptionAPI(state.fbPageId, state.token);
  // subscribed_apps lists the APPS subscribed to the page, keyed by app id.
  const subscribed = (check?.data ?? []).some(
    (app) =>
      app.id === env.FB_APP_ID &&
      (app.subscribed_fields ?? []).includes("leadgen"),
  );

  if (subscribed) {
    logger.debug({ userId, businessId }, "Leadgen subscription active");
    return;
  }

  logger.warn(
    { userId, businessId, pageId: state.fbPageId },
    "Leadgen subscription missing; resubscribing",
  );
  await subscribeToWebHookAPI(state.fbPageId, state.token);
  await repo.upsert(toUpsert(state, { subscribed: true }));
}

/**
 * Daily per-account job (a BullMQ job scheduler, so it never stacks). A
 * transient Graph failure is retried with backoff; a permanent one (token
 * revoked, app removed without permission to resubscribe) or the final failed
 * attempt is recorded as "reconnect required" and reported.
 */
export function startSubscriptionWorker(): QueueWorker {
  return queue.process(JobNames.FACEBOOK_CHECK_SUBSCRIPTION, async (job) => {
    const { userId, businessId } = job.data ?? {};
    if (!Number.isInteger(userId) || !Number.isInteger(businessId)) {
      // Retrying a malformed payload cannot help.
      logger.error({ jobId: job.id }, "Subscription check with malformed payload");
      return;
    }

    await runWithTerminalHandling<FacebookCheckSubscriptionPayload>(
      job,
      {
        maxAttempts: MAX_ATTEMPTS,
        isFatal: (err) => err instanceof FbTokenFatalError,
        onTerminal: (payload, err) =>
          failures.recordAndNotify({
            userId: payload.userId,
            businessId: payload.businessId,
            reason: "facebook_subscription_lost",
            error: err,
          }),
      },
      async () => {
        try {
          await checkSubscription(userId, businessId);
        } catch (err) {
          throw isRetryableError(err)
            ? new FbTokenRetryableError("Subscription check failed (transient)", err)
            : new FbTokenFatalError("Subscription check failed", err);
        }
      },
    );
  });
}
