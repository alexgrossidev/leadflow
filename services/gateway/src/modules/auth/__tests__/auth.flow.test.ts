import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { AuthService } from "../auth.service.js";
import { AuthController, REFRESH_COOKIE } from "../auth.controller.js";
import { createAuthRouter } from "../auth.route.js";
import type { AuthStore } from "../auth.repo.js";
import type { NewRefreshToken, RefreshTokenRecord, User } from "../auth.table.js";
import { LoginRateLimiter, type RateLimitStore } from "../login-rate-limit.js";
import { globalErrorHandler } from "#core/middleware/error-handler";

const PASSWORD = "correct horse battery staple";
const PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 4);

/** In-memory AuthStore with the same compare-and-set semantics as the SQL one. */
class MemoryAuthStore implements AuthStore {
  users: User[] = [
    {
      id: 1,
      username: "demo",
      email: "demo@example.com",
      name: "Demo",
      company: null,
      phone: null,
      passwordHash: PASSWORD_HASH,
      createdAt: null,
      updatedAt: null,
    },
  ];
  tokens: RefreshTokenRecord[] = [];

  async findUserByUsernameOrEmail(identifier: string) {
    return this.users.find((u) => u.username === identifier || u.email === identifier) ?? null;
  }
  async insertRefreshToken(token: NewRefreshToken) {
    this.tokens.push({
      id: this.tokens.length + 1,
      revokedAt: null,
      createdAt: new Date(),
      ...token,
    } as RefreshTokenRecord);
  }
  async findRefreshToken(tokenHash: string) {
    return this.tokens.find((t) => t.tokenHash === tokenHash) ?? null;
  }
  async rotateRefreshToken(currentId: number, next: NewRefreshToken) {
    const current = this.tokens.find((t) => t.id === currentId);
    if (!current || current.revokedAt) return false;
    current.revokedAt = new Date();
    await this.insertRefreshToken(next);
    return true;
  }
  async revokeFamily(familyId: string) {
    for (const t of this.tokens) if (t.familyId === familyId && !t.revokedAt) t.revokedAt = new Date();
  }
}

class MemoryRateLimitStore implements RateLimitStore {
  counts = new Map<string, number>();
  failing = false;
  async hit(key: string) {
    if (this.failing) throw new Error("redis down");
    const next = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, next);
    return next;
  }
  async reset(key: string) {
    this.counts.delete(key);
  }
}

function refreshCookie(res: request.Response): string {
  const cookies = ([] as string[]).concat(res.headers["set-cookie"] ?? []);
  const cookie = cookies.find((c) => c.startsWith(`${REFRESH_COOKIE}=`));
  if (!cookie) throw new Error("refresh cookie not set");
  return cookie;
}

const tokenOf = (cookie: string) => cookie.split(";")[0]!.slice(REFRESH_COOKIE.length + 1);

describe("auth flow", () => {
  let store: MemoryAuthStore;
  let limiterStore: MemoryRateLimitStore;
  let app: express.Express;

  beforeEach(() => {
    store = new MemoryAuthStore();
    limiterStore = new MemoryRateLimitStore();
    const service = new AuthService(
      store,
      new LoginRateLimiter(limiterStore, { maxAttempts: 3, windowMs: 60_000 }),
    );
    app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use("/auth", createAuthRouter(new AuthController(service)));
    app.use(globalErrorHandler);
  });

  const login = (username = "demo", password = PASSWORD) =>
    request(app).post("/auth/login").send({ username, password });

  it("logs in with 200, an access token and a scoped httpOnly refresh cookie", async () => {
    const res = await login();

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.expiresIn).toBe(900);

    const cookie = refreshCookie(res);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/Path=\/auth/);
    expect(cookie).toMatch(/SameSite=Strict/i);
  });

  it("accepts the email address as the username", async () => {
    expect((await login("demo@example.com")).status).toBe(200);
  });

  it("answers unknown users and wrong passwords with the same 401", async () => {
    const unknown = await login("nobody", PASSWORD);
    const wrong = await login("demo", "wrong password");

    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body).toEqual(wrong.body);
    expect(unknown.body.code).toBe("INVALID_CREDENTIALS");
  });

  it("rejects a malformed login body with 400", async () => {
    const res = await request(app).post("/auth/login").send({ username: "demo" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("VALIDATION_ERROR");
  });

  it("never puts the password hash in any token", async () => {
    const res = await login();
    const accessToken: string = res.body.data.accessToken;
    const refreshToken = tokenOf(refreshCookie(res));

    const claims = jwt.decode(accessToken, { complete: true });
    expect(claims?.header.alg).toBe("HS256");
    expect(Object.keys(claims?.payload as object).sort()).toEqual(["exp", "iat", "sub"]);
    expect(accessToken).not.toContain(PASSWORD_HASH);

    // The refresh token is opaque random bytes, and only its digest is stored.
    expect(refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(store.tokens.map((t) => t.tokenHash)).not.toContain(refreshToken);
  });

  it("rotates the refresh token on every refresh", async () => {
    const first = tokenOf(refreshCookie(await login()));

    const res = await request(app).post("/auth/refresh").set("Cookie", `${REFRESH_COOKIE}=${first}`);

    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    const second = tokenOf(refreshCookie(res));
    expect(second).not.toBe(first);
    expect(store.tokens).toHaveLength(2);
    expect(store.tokens[0]!.revokedAt).not.toBeNull();
    expect(store.tokens[1]!.familyId).toBe(store.tokens[0]!.familyId);
  });

  it("revokes the whole family when a rotated token is reused", async () => {
    const first = tokenOf(refreshCookie(await login()));
    const rotated = await request(app)
      .post("/auth/refresh")
      .set("Cookie", `${REFRESH_COOKIE}=${first}`);
    const second = tokenOf(refreshCookie(rotated));

    // An attacker replays the stolen, already-rotated token...
    const replay = await request(app).post("/auth/refresh").set("Cookie", `${REFRESH_COOKIE}=${first}`);
    expect(replay.status).toBe(401);
    expect(replay.body.code).toBe("REFRESH_TOKEN_REUSED");

    // ...which also kills the legitimate user's current token.
    const legit = await request(app).post("/auth/refresh").set("Cookie", `${REFRESH_COOKIE}=${second}`);
    expect(legit.status).toBe(401);
  });

  it("rejects a refresh without a cookie with 401 (bodiless POST is not a 400)", async () => {
    const res = await request(app).post("/auth/refresh");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("REFRESH_TOKEN_INVALID");
  });

  it("logs out with 204, clears the cookie and ends the session", async () => {
    const token = tokenOf(refreshCookie(await login()));

    const res = await request(app).post("/auth/logout").set("Cookie", `${REFRESH_COOKIE}=${token}`);
    expect(res.status).toBe(204);
    expect(res.text).toBe("");
    expect(refreshCookie(res)).toMatch(/Expires=Thu, 01 Jan 1970/);

    const after = await request(app).post("/auth/refresh").set("Cookie", `${REFRESH_COOKIE}=${token}`);
    expect(after.status).toBe(401);
  });

  it("rate limits repeated attempts per IP and username with 429", async () => {
    for (let i = 0; i < 3; i++) expect((await login("demo", "wrong")).status).toBe(401);
    const blocked = await login("demo", PASSWORD);
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe("LOGIN_RATE_LIMITED");
  });

  it("fails open when the rate limit store is unavailable", async () => {
    limiterStore.failing = true;
    expect((await login()).status).toBe(200);
  });
});
