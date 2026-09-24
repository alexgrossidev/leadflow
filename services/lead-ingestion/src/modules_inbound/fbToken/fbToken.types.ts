/** `GET /oauth/access_token` (code exchange and fb_exchange_token grant). */
export interface FbTokenExchangeResponse {
  access_token: string;
  token_type?: string;
  /** Seconds until expiry; absent on some long-lived tokens. */
  expires_in?: number;
}

/** A single page entry returned by `GET /me/accounts`. */
export interface FbPage {
  id: string;
  name?: string;
  access_token?: string;
  tasks?: string[];
}

export interface FbPageTokenExchangeResponse {
  data: FbPage[];
}

/** The part of `GET /debug_token` we rely on. */
export interface DebugTokenResponse {
  data?: {
    is_valid: boolean;
    type: string;
    profile_id?: string;
  };
}

/** `GET /{page-id}/subscribed_apps`. */
export interface SubscribedAppsResponse {
  data?: { id?: string; subscribed_fields?: string[] }[];
}
