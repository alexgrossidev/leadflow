/** How long (in seconds) a QR code is valid before it must be refreshed. */
export const QR_TTL_SECONDS = 60;

/** Consecutive QR refresh failures before the session is marked `failed`. */
export const QR_MAX_REFRESH_FAILURES = 3;

/** Failures older than this no longer count as "consecutive". */
export const QR_FAILURE_WINDOW_SECONDS = 600;

/**
 * Minimum gap between two QR refreshes for the same session. Frontends poll
 * GET /qr every few seconds; without a cooldown every poll after expiry would
 * restart the session on the transport, and the new QR could never arrive.
 */
export const QR_REFRESH_COOLDOWN_MS = 20_000;

/**
 * TTL for the per-session init lock. The lock guards only the init critical
 * section (DB upsert + transport call), which completes in well under 10 s; the
 * TTL is a safety net so a crash mid-init does not block other replicas for long.
 */
export const LOCK_INIT_TTL_SECONDS = 60;

/**
 * Window after a fresh init during which an "authenticated" webhook on a
 * `connecting` session is ignored. wppconnect fires a cached-browser "inChat"
 * right after start-session; a real login always goes qr_ready → qr_scanned first.
 */
export const FRESH_INIT_WINDOW_MS = 12_000;

/** Pause after clearing transport data so wppconnect can release the browser. */
export const REINIT_SETTLE_MS = 1_500;

/** Upper bound for the reconnect backoff (1 s, 2 s, 4 s, ... capped here). */
export const RECONNECT_BACKOFF_CAP_MS = 30_000;

/** Statuses whose transport session must be cleared before a re-init. */
export const ACTIVE_STATUSES = ["connected", "disconnected", "qr_ready", "qr_scanned", "connecting"] as const;
