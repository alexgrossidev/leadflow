import type {
  FacebookToken,
  FacebookTokenUserData,
} from "../../modules_inbound/fbToken/fbToken.table";
import type { FbPage, TokenState } from "./token.types";

/** Page tasks that mark a page as usable for lead advertising. */
const REQUIRED_TASKS = ["ADVERTISE"];

/** Fallback lifetime when Graph omits `expires_in` (long-lived user tokens: ~60 days). */
const DEFAULT_EXPIRY_SECONDS = 60 * 24 * 60 * 60;

/** Compute an absolute expiry from a relative "seconds from now" value. */
export function calculateExpiry(
  secondsToExpiry: number = DEFAULT_EXPIRY_SECONDS,
  now: number = Date.now(),
): Date {
  const expiresAt = new Date(now + secondsToExpiry * 1000);
  expiresAt.setMilliseconds(0);
  return expiresAt;
}

/**
 * Pick the page to persist: the first page that holds a required task, falling
 * back to the first page so we always store something. `isValid` reflects
 * whether the chosen page actually carries the required permission.
 */
export function selectAdvertisablePage(
  pages: FbPage[],
  requiredTasks: string[] = REQUIRED_TASKS,
): { selectedPage: FbPage | undefined; isValid: boolean } {
  const validPage = pages.find((page) =>
    page.tasks?.some((task) => requiredTasks.includes(task)),
  );
  const selectedPage = validPage ?? pages[0];
  const isValid = !!validPage?.access_token;
  return { selectedPage, isValid };
}

// ── Step guards ──────────────────────────────────────────────────────────────
// Each maps the persisted state to whether its step still has work to do. Pure,
// so the state machine's branching is unit-testable on its own.

/**
 * The code exchange runs exactly once per OAuth code. The row remembers a hash
 * of the code it was built from, which separates the two cases a
 * `token_type`-based guard confuses:
 *  - a retry of the same job (hash matches) resumes from persisted progress
 *    instead of replaying the single-use code, which Graph would reject;
 *  - a reconnect (new code, new hash) re-exchanges even when a fully set-up
 *    page row already exists, so the fresh grant is never ignored.
 */
export const needsUserToken = (state: TokenState, codeHash: string): boolean =>
  !state || state.oauthCodeHash !== codeHash;

export const needsPageToken = (state: TokenState): state is FacebookToken =>
  !!state && state.tokenType === "user";

export const needsValidation = (state: TokenState): state is FacebookToken =>
  !!state && state.tokenType === "page" && (!state.valid || !state.fbPageId);

export const needsSubscription = (state: TokenState): state is FacebookToken =>
  !!state &&
  state.tokenType === "page" &&
  state.valid &&
  !!state.fbPageId &&
  !state.subscribed;

export const isReadyForFollowups = (
  state: TokenState,
): state is FacebookToken & { fbPageId: string } =>
  !!state && state.tokenType === "page" && !!state.fbPageId && !!state.token;

/**
 * Full upsert payload from the live row plus the fields a step changes, so no
 * step can accidentally null out state it does not own (e.g. the retained
 * refresh token or the OAuth code hash).
 */
export function toUpsert(
  state: FacebookToken,
  overrides: Partial<FacebookTokenUserData>,
): FacebookTokenUserData {
  return {
    userId: state.userId,
    businessId: state.businessId,
    token: state.token,
    tokenType: state.tokenType,
    fbPageId: state.fbPageId,
    valid: state.valid,
    subscribed: state.subscribed,
    expiresAt: state.expiresAt,
    refreshToken: state.refreshToken,
    oauthCodeHash: state.oauthCodeHash,
    ...overrides,
  };
}
