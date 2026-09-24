import { env } from "#config/env";
import { FacebookController } from "./facebook.controller";
import { FacebookService } from "./facebook.service";
import { FacebookTokenService } from "../fbToken/fbToken.service";
import { redisNonceStore } from "./oauth.nonce";

/** Production wiring; tests build a controller with injected collaborators. */
export function createFacebookController(): FacebookController {
  return new FacebookController(
    new FacebookService(),
    new FacebookTokenService(),
    redisNonceStore,
    {
      appId: env.FB_APP_ID,
      apiVersion: env.FB_API_VERSION,
      redirectUri: env.FB_REDIRECT_URI,
      scopes: env.FB_OAUTH_SCOPES,
      stateSecret: env.OAUTH_STATE_SECRET,
      serviceToken: env.SERVICE_TOKEN,
    },
  );
}
