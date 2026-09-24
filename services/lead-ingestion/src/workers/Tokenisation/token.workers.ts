import { queue } from "#core/queue";
import { JobNames, type FacebookExchangeTokenPayload } from "@leadflow/shared/jobs";
import type { QueueWorker } from "@leadflow/shared/queue";
import { TOKEN_EXCHANGE_PROCESS } from "#dispatchers/token.PROCESS";
import { TOKEN_REFRESH_PROCESS } from "#dispatchers/refresh.PROCESS";
import { FbTokenFatalError } from "../../modules_inbound/fbToken/fbToken.errors";
import { TokenFailureService } from "../../modules_inbound/fbToken/tokenFailure.service";
import { runWithTerminalHandling } from "../terminal";

/** Must match the `attempts` FacebookTokenService enqueues the exchange with. */
const EXCHANGE_ATTEMPTS = 5;

/**
 * Connect flow. A fatal failure (consumed code, no advertisable page, token
 * rejected by debug_token) or an exhausted transient one is recorded in
 * facebook_token_failure and reported, so the user is prompted to reconnect
 * instead of the connection silently never completing.
 */
export function startTokenExchangeWorker(): QueueWorker {
  const failures = new TokenFailureService();
  return queue.process(JobNames.FACEBOOK_EXCHANGE_TOKEN, (job) =>
    runWithTerminalHandling<FacebookExchangeTokenPayload>(
      job,
      {
        maxAttempts: EXCHANGE_ATTEMPTS,
        isFatal: (err) => err instanceof FbTokenFatalError,
        onTerminal: (payload, err) =>
          failures.recordAndNotify({
            userId: payload.userId,
            businessId: payload.businessId,
            reason: "facebook_connect_failed",
            error: err,
          }),
      },
      () => TOKEN_EXCHANGE_PROCESS(job.data),
    ),
  );
}

/**
 * Reactive/manual heal entry point. The periodic sync also heals inline; this
 * lets ops trigger an immediate refresh. A transient failure throws so BullMQ
 * retries; an unrecoverable token is dead-lettered and reported inside the
 * process, which then resolves without throwing.
 */
export function startTokenRefreshWorker(): QueueWorker {
  return queue.process(JobNames.FACEBOOK_REFRESH_TOKEN, async (job) => {
    await TOKEN_REFRESH_PROCESS(job.data);
  });
}
