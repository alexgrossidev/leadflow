import { logger as defaultLogger, type Logger } from "#core/logger";
import { queue } from "#core/queue";
import { isRetryableError } from "#core/retry";
import { sha256Hex } from "#core/secrets";
import {
  JobNames,
  type FacebookExchangeTokenPayload,
  type TypedQueueClient,
} from "@leadflow/shared/jobs";

import { FacebookTokenRepository } from "../../modules_inbound/fbToken/fbToken.repo";
import {
  debugPageTokenAPI,
  extendToLongLivedTokenAPI,
  getAccessTokenAPI,
  getPageTokensAPI,
  subscribeToWebHookAPI,
} from "../../modules_inbound/fbToken/fbToken.API";
import type { FbTokenExchangeResponse } from "../../modules_inbound/fbToken/fbToken.types";
import {
  FbTokenFatalError,
  FbTokenRetryableError,
} from "../../modules_inbound/fbToken/fbToken.errors";
import { TokenFailureService } from "../../modules_inbound/fbToken/tokenFailure.service";

import type { TokenExchangeApi, TokenState } from "./token.types";
import {
  calculateExpiry,
  isReadyForFollowups,
  needsPageToken,
  needsSubscription,
  needsUserToken,
  needsValidation,
  selectAdvertisablePage,
  toUpsert,
} from "./token.logic";

/** Only the queue surface the followups step needs, narrowed for easy faking. */
type TokenQueue = Pick<TypedQueueClient, "schedule">;

export type TokenStore = Pick<FacebookTokenRepository, "findByAccount" | "upsert">;

export interface TokenExchangeDeps {
  repo: TokenStore;
  api: TokenExchangeApi;
  queue: TokenQueue;
  failures: Pick<TokenFailureService, "markResolved">;
  logger: Logger;
}

const SUBSCRIPTION_CHECK_EVERY_MS = 24 * 60 * 60 * 1000;
const PERIODIC_SYNC_EVERY_MS = 10 * 60 * 1000;

const defaultTokenApi: TokenExchangeApi = {
  getAccessToken: getAccessTokenAPI,
  extendToLongLived: extendToLongLivedTokenAPI,
  getPageTokens: getPageTokensAPI,
  debugPageToken: debugPageTokenAPI,
  subscribeToWebhook: subscribeToWebHookAPI,
};

/**
 * Drives the Facebook connect flow as a sequence of guarded steps, each
 * advancing the persisted token row:
 *   exchange code → page token → validate → subscribe → schedule followups.
 * Every collaborator is injected (defaulting to the real implementation) so a
 * single step can be exercised in isolation with fakes.
 */
export class TokenExchangeDispatcher {
  private readonly repo: TokenStore;
  private readonly api: TokenExchangeApi;
  private readonly queue: TokenQueue;
  private readonly failures: Pick<TokenFailureService, "markResolved">;
  private readonly log: Logger;

  constructor(deps: Partial<TokenExchangeDeps> = {}) {
    this.repo = deps.repo ?? new FacebookTokenRepository();
    this.api = deps.api ?? defaultTokenApi;
    this.queue = deps.queue ?? queue;
    this.failures = deps.failures ?? new TokenFailureService();
    this.log = deps.logger ?? defaultLogger;
  }

  /**
   * Resumes from the last persisted step: every step is guarded by the row
   * re-read from the DB, so a retry never re-runs a completed call. In
   * particular the single-use OAuth code is exchanged at most once per code
   * (see `needsUserToken`).
   */
  async run(input: FacebookExchangeTokenPayload): Promise<void> {
    const codeHash = sha256Hex(input.accessToken);
    let state: TokenState = await this.runStep("load", () =>
      this.repo.findByAccount(input.userId, input.businessId),
    );
    state = await this.runStep("exchangeUserToken", () =>
      this.exchangeUserToken(input, codeHash, state),
    );
    state = await this.runStep("fetchPageToken", () =>
      this.fetchPageToken(input, state),
    );
    state = await this.runStep("validatePageToken", () =>
      this.validatePageToken(input, state),
    );
    state = await this.runStep("subscribeWebhook", () =>
      this.subscribeWebhook(input, state),
    );
    await this.runStep("scheduleFollowups", () =>
      this.scheduleFollowups(state),
    );
  }

  /**
   * Log the failing stage and normalise into a classified, cause-preserving
   * error: domain failures pass through, transient faults become retryable
   * (the worker resumes from the last persisted step), anything else is fatal.
   */
  private async runStep<T>(stage: string, op: () => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch (err) {
      this.log.error({ stage, err }, `Token exchange step '${stage}' failed`);
      if (err instanceof FbTokenRetryableError || err instanceof FbTokenFatalError) {
        throw err;
      }
      throw isRetryableError(err)
        ? new FbTokenRetryableError(`${stage} failed (transient)`, err)
        : new FbTokenFatalError(`${stage} failed`, err);
    }
  }

  /** STEP 1: exchange the OAuth code for a user token and persist it. */
  async exchangeUserToken(
    input: FacebookExchangeTokenPayload,
    codeHash: string,
    state: TokenState,
  ): Promise<TokenState> {
    if (!needsUserToken(state, codeHash)) return state;

    // A consumed/expired code yields a 4xx (fatal, replaying cannot help); a
    // 5xx/network blip is transient. runStep performs that classification.
    // The one unrecoverable window is Graph accepting the code and the upsert
    // below failing: the code is spent, so the user has to reconnect.
    const shortLived = await this.api.getAccessToken(input.accessToken);

    // Extend to a long-lived (~60d) user token so page tokens minted from it do
    // not expire, and retain it in `refresh_token` for the refresh flow.
    const userToken = await this.toLongLived(shortLived);

    // A new connection starts over: token_type "user" re-arms every later step.
    // fb_page_id is deliberately left alone until the page step replaces it.
    await this.repo.upsert({
      userId: input.userId,
      businessId: input.businessId,
      token: userToken.access_token,
      tokenType: "user",
      refreshToken: userToken.access_token,
      expiresAt: calculateExpiry(userToken.expires_in),
      valid: false,
      subscribed: false,
      oauthCodeHash: codeHash,
    });

    return this.repo.findByAccount(input.userId, input.businessId);
  }

  /**
   * Best-effort upgrade of a short-lived user token. If it blips we keep the
   * short-lived token (the flow still completes) and the refresh flow extends
   * it on its next pass.
   */
  private async toLongLived(
    shortLived: FbTokenExchangeResponse,
  ): Promise<FbTokenExchangeResponse> {
    try {
      return await this.api.extendToLongLived(shortLived.access_token);
    } catch (err) {
      this.log.warn(
        { err },
        "Long-lived token exchange failed; retaining short-lived user token",
      );
      return shortLived;
    }
  }

  /** STEP 2: trade the user token for a page token and persist the selection. */
  async fetchPageToken(
    input: FacebookExchangeTokenPayload,
    state: TokenState,
  ): Promise<TokenState> {
    if (!needsPageToken(state)) return state;

    const { data: pages } = await this.api.getPageTokens(state.token);
    const { selectedPage } = selectAdvertisablePage(pages ?? []);

    if (!selectedPage?.access_token) {
      throw new FbTokenFatalError("No page access token found for this account");
    }

    // valid=false until debug_token confirms it (step 3), even on a reconnect
    // that lands on a previously validated row.
    await this.repo.upsert(
      toUpsert(state, {
        token: selectedPage.access_token,
        tokenType: "page",
        fbPageId: selectedPage.id,
        valid: false,
        subscribed: false,
      }),
    );
    this.log.info(
      { userId: input.userId, businessId: input.businessId, pageId: selectedPage.id },
      "Page token stored",
    );

    return this.repo.findByAccount(input.userId, input.businessId);
  }

  /** STEP 3: debug an unverified page token and stamp its real page id. */
  async validatePageToken(
    input: FacebookExchangeTokenPayload,
    state: TokenState,
  ): Promise<TokenState> {
    if (!needsValidation(state)) return state;

    const response = await this.api.debugPageToken(state.token);
    const data = response?.data;

    if (!data?.is_valid || data.type !== "PAGE") {
      throw new FbTokenFatalError(
        "debug_token rejected the page token (invalid or not a PAGE token)",
      );
    }

    await this.repo.upsert(
      toUpsert(state, {
        valid: true,
        fbPageId: data.profile_id ?? state.fbPageId,
      }),
    );
    this.log.info(
      { userId: input.userId, businessId: input.businessId, pageId: data.profile_id },
      "Page token validated",
    );

    return this.repo.findByAccount(input.userId, input.businessId);
  }

  /** STEP 4: subscribe the page to leadgen webhooks and mark it subscribed. */
  async subscribeWebhook(
    input: FacebookExchangeTokenPayload,
    state: TokenState,
  ): Promise<TokenState> {
    if (!needsSubscription(state)) return state;

    await this.api.subscribeToWebhook(state.fbPageId!, state.token);
    await this.repo.upsert(toUpsert(state, { subscribed: true }));
    return this.repo.findByAccount(input.userId, input.businessId);
  }

  /**
   * STEP 5: arm the daily subscription check and the reconciliation sync, and
   * close any open "reconnect required" row. Both schedules are BullMQ job
   * schedulers keyed per account, so a reconnect replaces rather than stacks them.
   */
  async scheduleFollowups(state: TokenState): Promise<void> {
    if (!isReadyForFollowups(state)) {
      throw new FbTokenFatalError(
        "Final token state invalid: missing page id or page token",
      );
    }
    const account = `${state.userId}_${state.businessId}`;

    await this.queue.schedule(
      JobNames.FACEBOOK_CHECK_SUBSCRIPTION,
      { userId: state.userId, businessId: state.businessId, retryCount: 0 },
      {
        repeat: { every: SUBSCRIPTION_CHECK_EVERY_MS },
        jobId: `fb_subcheck_${account}`,
        attempts: 5,
        backoff: { type: "exponential", delay: 60_000 },
      },
    );

    await this.queue.schedule(
      JobNames.FACEBOOK_PERIODIC_SYNC,
      { userId: state.userId, pageId: state.fbPageId },
      { repeat: { every: PERIODIC_SYNC_EVERY_MS }, jobId: `fb_sync_${account}` },
    );

    await this.failures.markResolved(state.userId, state.businessId);
  }
}
