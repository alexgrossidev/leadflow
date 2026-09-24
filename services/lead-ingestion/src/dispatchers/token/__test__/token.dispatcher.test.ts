import { describe, it, expect, vi } from "vitest";
import {
  TokenExchangeDispatcher,
  type TokenStore,
} from "#dispatchers/token/token.dispatcher";
import { needsUserToken } from "#dispatchers/token/token.logic";
import type { TokenExchangeApi } from "#dispatchers/token/token.types";
import {
  FbTokenFatalError,
  FbTokenRetryableError,
} from "#modules/fbToken/fbToken.errors";
import type {
  FacebookToken,
  FacebookTokenUserData,
} from "#modules/fbToken/fbToken.table";
import { ExternalHttpError } from "#core/http/http.errors";
import { sha256Hex } from "#core/secrets";
import { JobNames } from "@leadflow/shared/jobs";

const USER = 1001;
const BUSINESS = 2001;

/** In-memory facebook_token table with the repository's upsert semantics. */
function memoryTokenStore(initial?: Partial<FacebookToken>) {
  let row: FacebookToken | null = initial
    ? ({
        id: 1,
        userId: USER,
        businessId: BUSINESS,
        fbPageId: null,
        token: "t",
        tokenType: "page",
        subscribed: false,
        valid: false,
        expiresAt: new Date(),
        refreshToken: null,
        oauthCodeHash: null,
        lastSyncedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...initial,
      } as FacebookToken)
    : null;

  const store: TokenStore & { current: () => FacebookToken | null } = {
    current: () => row,
    findByAccount: vi.fn(async () => (row ? { ...row } : null)),
    upsert: vi.fn(async (data: FacebookTokenUserData) => {
      // Mirror ON DUPLICATE KEY UPDATE: undefined fields leave the column alone.
      const defined = Object.fromEntries(
        Object.entries(data).filter(([, v]) => v !== undefined),
      );
      row = {
        ...(row ?? {
          id: 1,
          fbPageId: null,
          refreshToken: null,
          oauthCodeHash: null,
          lastSyncedAt: null,
          valid: false,
          createdAt: new Date(),
        }),
        ...defined,
        updatedAt: new Date(),
      } as FacebookToken;
    }),
  };
  return store;
}

function fakeApi(): { [K in keyof TokenExchangeApi]: ReturnType<typeof vi.fn> } {
  return {
    getAccessToken: vi.fn().mockResolvedValue({ access_token: "short-user", expires_in: 3600 }),
    extendToLongLived: vi.fn().mockResolvedValue({ access_token: "long-user", expires_in: 5_184_000 }),
    getPageTokens: vi.fn().mockResolvedValue({
      data: [{ id: "page_1", access_token: "page-token", tasks: ["ADVERTISE"] }],
    }),
    debugPageToken: vi.fn().mockResolvedValue({
      data: { is_valid: true, type: "PAGE", profile_id: "page_1" },
    }),
    subscribeToWebhook: vi.fn().mockResolvedValue({ success: true }),
  };
}

function setup(initial?: Partial<FacebookToken>) {
  const repo = memoryTokenStore(initial);
  const api = fakeApi();
  const queue = { schedule: vi.fn().mockResolvedValue(undefined) };
  const failures = { markResolved: vi.fn().mockResolvedValue(undefined) };
  const dispatcher = new TokenExchangeDispatcher({
    repo,
    api: api as unknown as TokenExchangeApi,
    queue,
    failures,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never,
  });
  return { dispatcher, repo, api, queue, failures };
}

const job = (code: string) => ({
  userId: USER,
  businessId: BUSINESS,
  accessToken: code,
  createdTime: Date.now(),
});

describe("needsUserToken", () => {
  const hash = sha256Hex("code-1");

  it("is true when nothing is persisted", () => {
    expect(needsUserToken(null, hash)).toBe(true);
  });

  it("is false for a row built from the same code (a retry)", () => {
    expect(
      needsUserToken({ tokenType: "user", oauthCodeHash: hash } as FacebookToken, hash),
    ).toBe(false);
  });

  it("is true for a fully set-up page row when a NEW code arrives (a reconnect)", () => {
    expect(
      needsUserToken(
        { tokenType: "page", oauthCodeHash: sha256Hex("old-code") } as FacebookToken,
        hash,
      ),
    ).toBe(true);
  });
});

describe("TokenExchangeDispatcher", () => {
  it("runs the whole flow for a first connection", async () => {
    const { dispatcher, repo, api, queue, failures } = setup();

    await dispatcher.run(job("code-1"));

    expect(api.getAccessToken).toHaveBeenCalledWith("code-1");
    expect(repo.current()).toMatchObject({
      token: "page-token",
      tokenType: "page",
      fbPageId: "page_1",
      valid: true,
      subscribed: true,
      refreshToken: "long-user",
      oauthCodeHash: sha256Hex("code-1"),
    });
    expect(queue.schedule).toHaveBeenCalledWith(
      JobNames.FACEBOOK_PERIODIC_SYNC,
      { userId: USER, pageId: "page_1" },
      expect.objectContaining({ jobId: `fb_sync_${USER}_${BUSINESS}` }),
    );
    expect(failures.markResolved).toHaveBeenCalledWith(USER, BUSINESS);
  });

  // Regression: the guard used to be `tokenType !== "page"`, so a retry after
  // step 1 replayed the already-consumed code and failed fatally.
  it("resumes a retry after step 1 without replaying the consumed code", async () => {
    const { dispatcher, api, repo } = setup();
    api.getPageTokens.mockRejectedValueOnce(
      new ExternalHttpError("Graph", "GET /me/accounts", 503, undefined),
    );

    await expect(dispatcher.run(job("code-1"))).rejects.toBeInstanceOf(
      FbTokenRetryableError,
    );
    expect(repo.current()?.tokenType).toBe("user");

    await dispatcher.run(job("code-1"));

    expect(api.getAccessToken).toHaveBeenCalledTimes(1);
    expect(repo.current()).toMatchObject({ tokenType: "page", subscribed: true });
  });

  // Regression: with a page row already present the same guard skipped the
  // exchange, silently ignoring the fresh grant of a reconnect.
  it("re-exchanges a new code even when a complete page row exists", async () => {
    const { dispatcher, api, repo } = setup({
      tokenType: "page",
      token: "old-page-token",
      fbPageId: "old_page",
      valid: true,
      subscribed: true,
      oauthCodeHash: sha256Hex("old-code"),
    });
    api.getPageTokens.mockResolvedValueOnce({
      data: [{ id: "page_2", access_token: "new-page-token", tasks: ["ADVERTISE"] }],
    });
    api.debugPageToken.mockResolvedValueOnce({
      data: { is_valid: true, type: "PAGE", profile_id: "page_2" },
    });

    await dispatcher.run(job("new-code"));

    expect(api.getAccessToken).toHaveBeenCalledWith("new-code");
    expect(repo.current()).toMatchObject({
      token: "new-page-token",
      fbPageId: "page_2",
      subscribed: true,
      oauthCodeHash: sha256Hex("new-code"),
    });
  });

  it("is a no-op replay once the same code has completed", async () => {
    const { dispatcher, api } = setup();
    await dispatcher.run(job("code-1"));
    await dispatcher.run(job("code-1"));

    expect(api.getAccessToken).toHaveBeenCalledTimes(1);
    expect(api.subscribeToWebhook).toHaveBeenCalledTimes(1);
  });

  it("classifies a rejected code (Graph 4xx) as fatal", async () => {
    const { dispatcher, api } = setup();
    api.getAccessToken.mockRejectedValueOnce(
      new ExternalHttpError("Graph", "GET /oauth/access_token", 400, undefined, {
        code: 100,
        message: "This authorization code has been used.",
      }),
    );
    await expect(dispatcher.run(job("code-1"))).rejects.toBeInstanceOf(
      FbTokenFatalError,
    );
  });

  it("keeps the short-lived token when the long-lived upgrade blips", async () => {
    const { dispatcher, api, repo } = setup();
    api.extendToLongLived.mockRejectedValueOnce(
      new ExternalHttpError("Graph", "GET /oauth/access_token", 500, undefined),
    );

    await dispatcher.run(job("code-1"));

    expect(repo.current()?.refreshToken).toBe("short-user");
  });

  it("fails fatally when the account has no page", async () => {
    const { dispatcher, api } = setup();
    api.getPageTokens.mockResolvedValueOnce({ data: [] });
    await expect(dispatcher.run(job("code-1"))).rejects.toBeInstanceOf(
      FbTokenFatalError,
    );
  });

  it("fails fatally when debug_token rejects the page token", async () => {
    const { dispatcher, api } = setup();
    api.debugPageToken.mockResolvedValueOnce({ data: { is_valid: false, type: "PAGE" } });
    await expect(dispatcher.run(job("code-1"))).rejects.toBeInstanceOf(
      FbTokenFatalError,
    );
  });
});
