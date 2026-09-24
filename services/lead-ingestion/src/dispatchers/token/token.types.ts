import type {
  DebugTokenResponse,
  FbPageTokenExchangeResponse,
  FbTokenExchangeResponse,
} from "../../modules_inbound/fbToken/fbToken.types";
import type { FacebookToken } from "../../modules_inbound/fbToken/fbToken.table";

export type {
  DebugTokenResponse,
  FbPage,
} from "../../modules_inbound/fbToken/fbToken.types";

/** The persisted token row as it travels through the exchange state machine. */
export type TokenState = FacebookToken | null;

/**
 * The Facebook Graph calls the exchange flow depends on, expressed as an
 * interface so tests can inject fakes instead of hitting the network.
 */
export interface TokenExchangeApi {
  getAccessToken(code: string): Promise<FbTokenExchangeResponse>;
  extendToLongLived(userToken: string): Promise<FbTokenExchangeResponse>;
  getPageTokens(userAccessToken: string): Promise<FbPageTokenExchangeResponse>;
  debugPageToken(pageAccessToken: string): Promise<DebugTokenResponse>;
  subscribeToWebhook(pageId: string, pageToken: string): Promise<unknown>;
}

/** The refresh/heal flow needs the same calls minus the code exchange. */
export type TokenRefreshApi = Omit<TokenExchangeApi, "getAccessToken">;
