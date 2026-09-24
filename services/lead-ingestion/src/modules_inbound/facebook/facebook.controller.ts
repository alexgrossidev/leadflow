import type { FastifyReply, FastifyRequest } from "fastify";
import { headerValue, safeEqual } from "#core/secrets";
import type { FacebookService } from "./facebook.service";
import type { FacebookTokenService } from "../fbToken/fbToken.service";
import {
  FacebookLeadWebhookPayloadSchema,
  fbConnectQuerySchema,
  fbOAuthCallbackQuerySchema,
  fbVerifyQuerySchema,
} from "./facebook.schema";
import { InvalidServiceTokenError } from "./facebook.errors";
import {
  createOAuthState,
  InvalidOAuthStateError,
  OAUTH_STATE_TTL_MS,
  verifyOAuthState,
} from "./oauth.state";
import type { NonceStore } from "./oauth.nonce";

export interface FacebookControllerConfig {
  appId: string;
  apiVersion: string;
  redirectUri: string;
  scopes: string;
  stateSecret: string;
  serviceToken: string;
}

type RawBodyRequest = FastifyRequest & { rawBody?: Buffer | string };

export class FacebookController {
  constructor(
    private readonly service: FacebookService,
    private readonly tokenService: FacebookTokenService,
    private readonly nonces: NonceStore,
    private readonly config: FacebookControllerConfig,
  ) {}

  /** preHandler for internal routes: the caller must present SERVICE_TOKEN. */
  requireServiceToken = async (req: FastifyRequest) => {
    const token = headerValue(req.headers["x-service-token"]);
    if (!safeEqual(token, this.config.serviceToken)) {
      throw new InvalidServiceTokenError();
    }
  };

  /** preHandler: verify the request really came from Facebook before parsing it. */
  verifySignature = async (req: FastifyRequest) => {
    this.service.assertValidSignature(
      (req as RawBodyRequest).rawBody,
      req.headers["x-hub-signature-256"],
    );
  };

  handshake = async (req: FastifyRequest, reply: FastifyReply) => {
    const query = fbVerifyQuerySchema.parse(req.query);
    const challenge = this.service.verifyWebhook(
      query["hub.mode"],
      query["hub.verify_token"],
      query["hub.challenge"],
    );
    return reply.code(200).type("text/plain").send(challenge);
  };

  /**
   * One GET URL serves both webhook verification (`hub.*`) and, because
   * FB_REDIRECT_URI may point at the same URL, the OAuth redirect (`code`).
   */
  fbCallback = async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as Record<string, unknown>;
    if (query["hub.mode"] !== undefined) return this.handshake(req, reply);
    if (query.code !== undefined || query.error !== undefined) {
      return this.oauthCallback(req, reply);
    }
    return reply.code(400).send({ error: "Unrecognized Facebook callback" });
  };

  capture = async (req: FastifyRequest, reply: FastifyReply) => {
    const payload = FacebookLeadWebhookPayloadSchema.parse(req.body);
    const summary = await this.service.enqueueLeads(payload);
    req.log.info(summary, "[Facebook] webhook accepted");
    return reply.code(200).send();
  };

  /**
   * Start of the connect flow. Called server-to-server by the gateway (hence
   * the service token), which forwards the 302 Location to the user's browser.
   */
  connect = async (req: FastifyRequest, reply: FastifyReply) => {
    const account = fbConnectQuerySchema.parse(req.query);
    const dialog = new URL(
      `https://www.facebook.com/${this.config.apiVersion}/dialog/oauth`,
    );
    dialog.searchParams.set("client_id", this.config.appId);
    dialog.searchParams.set("redirect_uri", this.config.redirectUri);
    dialog.searchParams.set("scope", this.config.scopes);
    dialog.searchParams.set("response_type", "code");
    dialog.searchParams.set(
      "state",
      createOAuthState(account, this.config.stateSecret),
    );
    return reply.redirect(dialog.toString(), 302);
  };

  /**
   * OAuth redirect target. The account comes only from the signed state, never
   * from the query string, and the state's nonce is burned so the URL is
   * single-use. The code itself is exchanged asynchronously by the worker.
   */
  oauthCallback = async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as Record<string, unknown>;
    if (query.error !== undefined) {
      // The user declined the dialog; there is no code to exchange.
      return reply.code(400).send({ error: "authorization_denied" });
    }

    const { code, state } = fbOAuthCallbackQuerySchema.parse(query);
    const claims = verifyOAuthState(state, this.config.stateSecret);
    if (!(await this.nonces.consume(claims.nonce, OAUTH_STATE_TTL_MS))) {
      throw new InvalidOAuthStateError("already used");
    }

    await this.tokenService.exchangeToken(code, claims.userId, claims.businessId);
    req.log.info(
      { userId: claims.userId, businessId: claims.businessId },
      "[Facebook] OAuth callback accepted; token exchange enqueued",
    );
    return reply.code(200).send({ status: "connecting" });
  };
}
