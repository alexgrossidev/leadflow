import { logger as defaultLogger, type Logger } from "#core/logger";
import { isRetryableError } from "#core/retry";
import type { FacebookRefreshTokenPayload } from "@leadflow/shared/jobs";

import { FacebookTokenRepository } from "../../modules_inbound/fbToken/fbToken.repo";
import {
  debugPageTokenAPI,
  extendToLongLivedTokenAPI,
  getPageTokensAPI,
  subscribeToWebHookAPI,
} from "../../modules_inbound/fbToken/fbToken.API";
import {
  FbTokenFatalError,
  FbTokenRetryableError,
} from "../../modules_inbound/fbToken/fbToken.errors";
import type { FacebookToken } from "../../modules_inbound/fbToken/fbToken.table";

import {
  calculateExpiry,
  selectAdvertisablePage,
  toUpsert,
} from "../token/token.logic";
import type { TokenStore } from "../token/token.dispatcher";
import type { TokenRefreshApi } from "../token/token.types";
import { storedUserToken, type TokenState } from "./refresh.logic";

export interface TokenRefreshDeps {
  repo: TokenStore;
  api: TokenRefreshApi;
  logger: Logger;
}

const defaultRefreshApi: TokenRefreshApi = {
  extendToLongLived: extendToLongLivedTokenAPI,
  getPageTokens: getPageTokensAPI,
  debugPageToken: debugPageTokenAPI,
  subscribeToWebhook: subscribeToWebHookAPI,
};

/**
 * Heals a stored Facebook token as a sequence of idempotent, classified steps:
 *   extend (long-lived user token) → re-mint page token → validate → resubscribe.
 * Each step is non-destructive to the live page token until its replacement is in
 * hand, so a mid-flight retry never leaves an account with a broken token. A
 * non-retryable failure (user revoked access / no advertisable page) surfaces as
 * an FbTokenFatalError, which the caller dead-letters and reports; a transient
 * fault becomes retryable so the queue resumes. Every collaborator is injected.
 */
export class TokenRefreshDispatcher {
  private readonly repo: TokenStore;
  private readonly api: TokenRefreshApi;
  private readonly log: Logger;

  constructor(deps: Partial<TokenRefreshDeps> = {}) {
    this.repo = deps.repo ?? new FacebookTokenRepository();
    this.api = deps.api ?? defaultRefreshApi;
    this.log = deps.logger ?? defaultLogger;
  }

  async run(input: FacebookRefreshTokenPayload): Promise<FacebookToken> {
    let state: TokenState = await this.runStep("load", () =>
      this.repo.findByAccount(input.userId, input.businessId),
    );
    if (!state) {
      throw new FbTokenFatalError(
        `No token row for user ${input.userId} / business ${input.businessId} to refresh`,
      );
    }

    state = await this.runStep("extendUserToken", () =>
      this.extendUserToken(state as FacebookToken),
    );
    state = await this.runStep("reMintPageToken", () =>
      this.reMintPageToken(state as FacebookToken),
    );
    state = await this.runStep("validatePageToken", () =>
      this.validatePageToken(state as FacebookToken),
    );
    state = await this.runStep("resubscribe", () =>
      this.resubscribe(state as FacebookToken),
    );
    return state as FacebookToken;
  }

  /** STEP 1 — Extend the retained user token to long-lived; store it only. */
  async extendUserToken(state: FacebookToken): Promise<FacebookToken> {
    const userToken = storedUserToken(state);
    if (!userToken) return state; // no retained user token: nothing to extend from

    const extended = await this.api.extendToLongLived(userToken);
    await this.repo.upsert(
      toUpsert(state, {
        refreshToken: extended.access_token,
        expiresAt: calculateExpiry(extended.expires_in),
      }),
    );
    return this.reload(state);
  }

  /** STEP 2 — Re-mint a fresh page token from the long-lived user token. */
  async reMintPageToken(state: FacebookToken): Promise<FacebookToken> {
    const userToken = storedUserToken(state);
    if (!userToken) return state; // can't re-mint without a user token

    const { data: pages } = await this.api.getPageTokens(userToken);
    const { selectedPage, isValid } = selectAdvertisablePage(pages ?? []);
    if (!selectedPage?.access_token) {
      throw new FbTokenFatalError("No advertisable page during token refresh");
    }

    await this.repo.upsert(
      toUpsert(state, {
        token: selectedPage.access_token,
        tokenType: "page",
        fbPageId: selectedPage.id,
        valid: isValid,
        subscribed: false, // a new page token must re-confirm its subscription
      }),
    );
    return this.reload(state);
  }

  /** STEP 3 — Confirm the (possibly re-minted) page token via debug_token. */
  async validatePageToken(state: FacebookToken): Promise<FacebookToken> {
    const response = await this.api.debugPageToken(state.token);
    const data = response?.data;

    if (!data?.is_valid || data.type !== "PAGE") {
      // Non-retryable: the user must reconnect. The caller dead-letters and reports.
      throw new FbTokenFatalError(
        "Refreshed token failed debug_token validation",
      );
    }

    await this.repo.upsert(
      toUpsert(state, {
        valid: true,
        fbPageId: data.profile_id ?? state.fbPageId,
      }),
    );
    return this.reload(state);
  }

  /** STEP 4 — Ensure the page is (re)subscribed to leadgen webhooks. */
  async resubscribe(state: FacebookToken): Promise<FacebookToken> {
    if (state.subscribed) return state;
    if (!state.fbPageId) {
      throw new FbTokenFatalError("No page id to resubscribe after refresh");
    }

    await this.api.subscribeToWebhook(state.fbPageId, state.token);
    await this.repo.upsert(toUpsert(state, { subscribed: true }));
    return this.reload(state);
  }

  /** Re-read the persisted row so the next step sees committed state. */
  private async reload(state: FacebookToken): Promise<FacebookToken> {
    const next = await this.repo.findByAccount(state.userId, state.businessId);
    if (!next) {
      throw new FbTokenFatalError(
        `Token row vanished mid-refresh (user ${state.userId})`,
      );
    }
    return next;
  }

  /**
   * Log the failing stage and normalise into a classified, cause-preserving
   * error: domain failures pass through, transient faults become retryable
   * (queue resumes), anything else is fatal (unrecoverable → dead-letter).
   */
  private async runStep<T>(stage: string, op: () => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch (err) {
      this.log.error({ stage, err }, `Token refresh step '${stage}' failed`);
      if (err instanceof FbTokenRetryableError || err instanceof FbTokenFatalError) {
        throw err;
      }
      throw isRetryableError(err)
        ? new FbTokenRetryableError(`${stage} failed (transient)`, err)
        : new FbTokenFatalError(`${stage} failed`, err);
    }
  }
}
