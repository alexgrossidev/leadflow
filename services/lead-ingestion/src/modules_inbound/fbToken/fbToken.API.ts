import { env } from "#config/env";
import { facebookClient } from "#core/http/facebook.client";
import type {
  DebugTokenResponse,
  FbPageTokenExchangeResponse,
  FbTokenExchangeResponse,
  SubscribedAppsResponse,
} from "./fbToken.types";

// Every function here fails with a redacted ExternalHttpError (see
// core/http/facebook.client.ts): the query strings below carry the app
// secret, user tokens and the OAuth code, and must never reach a log.

/** Trade the single-use OAuth code for a short-lived user token. */
export function getAccessTokenAPI(code: string): Promise<FbTokenExchangeResponse> {
  return facebookClient.get<FbTokenExchangeResponse>(`/oauth/access_token`, {
    params: {
      client_id: env.FB_APP_ID,
      client_secret: env.FB_APP_SECRET,
      // Must match the redirect_uri of the dialog request exactly.
      redirect_uri: env.FB_REDIRECT_URI,
      code,
    },
  });
}

/**
 * Trade a (short-lived) user token for a long-lived one (~60 days) via the
 * `fb_exchange_token` grant. Page tokens minted from a long-lived user token do
 * not expire, so this underpins the whole auto-heal path. Re-exchanging a
 * long-lived token just returns a fresh long-lived token.
 */
export function extendToLongLivedTokenAPI(
  userAccessToken: string,
): Promise<FbTokenExchangeResponse> {
  return facebookClient.get<FbTokenExchangeResponse>(`/oauth/access_token`, {
    params: {
      grant_type: "fb_exchange_token",
      client_id: env.FB_APP_ID,
      client_secret: env.FB_APP_SECRET,
      fb_exchange_token: userAccessToken,
    },
  });
}

export function getPageTokensAPI(
  userAccessToken: string,
): Promise<FbPageTokenExchangeResponse> {
  return facebookClient.get<FbPageTokenExchangeResponse>(`/me/accounts`, {
    params: { access_token: userAccessToken },
  });
}

export function debugPageTokenAPI(
  pageAccessToken: string,
): Promise<DebugTokenResponse> {
  return facebookClient.get<DebugTokenResponse>(`/debug_token`, {
    params: {
      input_token: pageAccessToken,
      access_token: `${env.FB_APP_ID}|${env.FB_APP_SECRET}`,
    },
  });
}

export function subscribeToWebHookAPI(
  pageId: string,
  pageToken: string,
): Promise<unknown> {
  return facebookClient.post(`/${pageId}/subscribed_apps`, null, {
    params: { subscribed_fields: "leadgen", access_token: pageToken },
  });
}

export function checkSubscriptionAPI(
  pageId: string,
  pageToken: string,
): Promise<SubscribedAppsResponse> {
  return facebookClient.get<SubscribedAppsResponse>(
    `/${pageId}/subscribed_apps`,
    { params: { access_token: pageToken } },
  );
}
