import type { FacebookRefreshTokenPayload } from "@leadflow/shared/jobs";

import { FbTokenRetryableError } from "../modules_inbound/fbToken/fbToken.errors";
import { TokenFailureService } from "../modules_inbound/fbToken/tokenFailure.service";
import { TokenRefreshDispatcher } from "./refresh/refresh.dispatcher";

export type RefreshResult = "healed" | "unrecoverable";

/** Stable reason code carried on FACEBOOK_TOKEN_REVOKED for the reconnect prompt. */
const RECONNECT_REASON = "facebook_reconnect_required";

export interface RefreshProcessDeps {
  dispatcher: Pick<TokenRefreshDispatcher, "run">;
  failures: TokenFailureService;
}

/**
 * One refresh/heal attempt with terminal handling baked in. Heals: clear any
 * open dead-letter row. Transient failure: rethrow so the queue retries.
 * Unrecoverable (user must reconnect): dead-letter, emit FACEBOOK_TOKEN_REVOKED,
 * and resolve to "unrecoverable" so callers (sync) skip that account without
 * crashing the whole run. Nothing is ever silently dropped.
 */
export async function TOKEN_REFRESH_PROCESS(
  payload: FacebookRefreshTokenPayload,
  deps: Partial<RefreshProcessDeps> = {},
): Promise<RefreshResult> {
  const dispatcher = deps.dispatcher ?? new TokenRefreshDispatcher();
  const failures = deps.failures ?? new TokenFailureService();

  try {
    await dispatcher.run(payload);
    await failures.markResolved(payload.userId, payload.businessId);
    return "healed";
  } catch (err) {
    if (err instanceof FbTokenRetryableError) throw err; // let the queue retry

    await failures.recordAndNotify({
      userId: payload.userId,
      businessId: payload.businessId,
      pageId: payload.pageId ?? null,
      reason: RECONNECT_REASON,
      error: err,
    });
    return "unrecoverable";
  }
}
