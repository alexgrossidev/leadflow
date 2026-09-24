import { describe, it, expect, vi } from "vitest";
import { withDbRetry } from "#database/resilient";
import { DatabaseError, dbOp, isDuplicateKey } from "#database/errors";

const connError = (code: string) => Object.assign(new Error(code), { code });

/** Drizzle's wrapper: SQL + params in the message, driver error one level down. */
const drizzleError = (code: string) =>
  Object.assign(
    new Error("Failed query: insert into facebook_token ...\nparams: 1001,EAAB-secret-token"),
    { cause: connError(code) },
  );

describe("withDbRetry", () => {
  it("retries a transient connection loss, then succeeds", async () => {
    const op = vi
      .fn()
      .mockRejectedValueOnce(connError("PROTOCOL_CONNECTION_LOST"))
      .mockResolvedValueOnce("ok");

    await expect(withDbRetry(op, { baseDelayMs: 1 })).resolves.toBe("ok");
    expect(op).toHaveBeenCalledTimes(2);
  });

  it("sees the code through Drizzle's wrapper and our DatabaseError", async () => {
    const op = vi
      .fn()
      .mockRejectedValueOnce(drizzleError("ECONNRESET"))
      .mockRejectedValueOnce(new DatabaseError("x", "ETIMEDOUT", undefined))
      .mockResolvedValueOnce("ok");

    await expect(withDbRetry(op, { baseDelayMs: 1 })).resolves.toBe("ok");
    expect(op).toHaveBeenCalledTimes(3);
  });

  it("does not retry a non-transient error", async () => {
    const op = vi.fn().mockRejectedValue(connError("ER_DUP_ENTRY"));
    await expect(withDbRetry(op, { baseDelayMs: 1 })).rejects.toThrow("ER_DUP_ENTRY");
    expect(op).toHaveBeenCalledTimes(1);
  });

  it("gives up after the configured retries", async () => {
    const op = vi.fn().mockRejectedValue(connError("ECONNREFUSED"));
    await expect(withDbRetry(op, { retries: 2, baseDelayMs: 1 })).rejects.toThrow();
    expect(op).toHaveBeenCalledTimes(3);
  });
});

describe("dbOp", () => {
  it("strips SQL params (tokens, PII) from the error it rethrows", async () => {
    const err = await dbOp("facebook_token.upsert", () =>
      Promise.reject(drizzleError("ER_DATA_TOO_LONG")),
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(DatabaseError);
    expect((err as DatabaseError).code).toBe("ER_DATA_TOO_LONG");
    expect((err as Error).message).not.toContain("secret-token");
    expect((err as Error).cause).toBeUndefined();
  });

  it("keeps duplicate-key detection working through the wrapper", async () => {
    const err = await dbOp("lead_delivery.claim", () =>
      Promise.reject(drizzleError("ER_DUP_ENTRY")),
    ).catch((e: unknown) => e);
    expect(isDuplicateKey(err)).toBe(true);
  });
});
