import { CookieOptions, Request, Response } from "express";
import { isProduction } from "#config/env";
import { REFRESH_TOKEN_TTL_MS } from "#core/auth/tokens";
import { noContent, ok } from "#core/http/response";
import { AuthService, Session } from "./auth.service.js";
import { loginBodySchema } from "./auth.schema.js";

export const REFRESH_COOKIE = "refresh_token";

// Scoped to /auth so the browser only sends the refresh token to the three
// endpoints that need it, never to the rest of the API.
const refreshCookieOptions: CookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: "strict",
  path: "/auth",
};

export class AuthController {
  constructor(private readonly service: AuthService) {}

  login = async (req: Request, res: Response) => {
    const { username, password } = loginBodySchema.parse(req.body);
    const session = await this.service.login(username, password, req.ip ?? "unknown");
    return this.sendSession(res, session);
  };

  refresh = async (req: Request, res: Response) => {
    const session = await this.service.refresh(this.readCookie(req));
    return this.sendSession(res, session);
  };

  logout = async (req: Request, res: Response) => {
    await this.service.logout(this.readCookie(req));
    res.clearCookie(REFRESH_COOKIE, refreshCookieOptions);
    return noContent(res);
  };

  private readCookie(req: Request): string | undefined {
    const value: unknown = req.cookies?.[REFRESH_COOKIE];
    return typeof value === "string" && value.length > 0 ? value : undefined;
  }

  private sendSession(res: Response, session: Session) {
    res.cookie(REFRESH_COOKIE, session.refreshToken, {
      ...refreshCookieOptions,
      maxAge: REFRESH_TOKEN_TTL_MS,
    });
    return ok(res, { accessToken: session.accessToken, expiresIn: session.expiresIn });
  }
}
