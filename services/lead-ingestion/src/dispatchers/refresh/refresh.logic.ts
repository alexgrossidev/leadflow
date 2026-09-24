import type { FacebookToken } from "../../modules_inbound/fbToken/fbToken.table";

export type TokenState = FacebookToken | null;

/** Refresh proactively once a token is within this margin of expiry (7 days). */
export const REFRESH_MARGIN_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Whether a persisted token warrants a refresh/heal pass: invalid, dropped its
 * subscription, missing its page id, or close enough to expiry that we should
 * re-mint now rather than risk a gap. Pure so the sync worker's branching is
 * unit-testable without a clock or DB.
 */
export function needsRefresh(
  state: TokenState,
  marginMs: number = REFRESH_MARGIN_MS,
  now: number = Date.now(),
): boolean {
  if (!state) return false; // nothing persisted to refresh
  if (!state.valid || !state.subscribed || !state.fbPageId) return true;
  const expiresAt = state.expiresAt ? new Date(state.expiresAt).getTime() : 0;
  return expiresAt - now <= marginMs;
}

/**
 * The retained long-lived user token (stored in `refresh_token`) we re-mint page
 * tokens from. Absent on rows that were created without one (e.g. seeded
 * demo data); the dispatcher then degrades to a validate-only pass.
 */
export const storedUserToken = (state: TokenState): string | null =>
  state?.refreshToken ?? null;
