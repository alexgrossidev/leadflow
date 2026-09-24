import { describe, it, expect } from "vitest";
import { isRetryableError } from "#core/retry";
import { ExternalHttpError } from "#core/http/http.errors";
import { DatabaseError } from "#database/errors";

const http = (status: number | undefined, code?: string, graphCode?: number) =>
  new ExternalHttpError("Graph", "GET /x", status, code, graphCode ? { code: graphCode } : undefined);

describe("isRetryableError", () => {
  it.each([500, 502, 503, 504, 408, 429])("retries HTTP %i", (status) => {
    expect(isRetryableError(http(status))).toBe(true);
  });

  it.each([400, 401, 403, 404, 422])("does not retry HTTP %i", (status) => {
    expect(isRetryableError(http(status))).toBe(false);
  });

  it("retries Graph throttling codes even though Meta sends them as HTTP 400", () => {
    expect(isRetryableError(http(400, undefined, 4))).toBe(true);
    expect(isRetryableError(http(400, undefined, 17))).toBe(true);
    expect(isRetryableError(http(400, undefined, 190))).toBe(false); // expired token
  });

  it("retries network failures with no response", () => {
    expect(isRetryableError(http(undefined, "ECONNABORTED"))).toBe(true);
    expect(isRetryableError(http(undefined, "ENOTFOUND"))).toBe(true);
  });

  it("follows the cause chain", () => {
    const wrapped = new Error("step failed", { cause: http(503) });
    expect(isRetryableError(wrapped)).toBe(true);
    expect(isRetryableError(new Error("x", { cause: new DatabaseError("op", "ER_LOCK_DEADLOCK", 1213) }))).toBe(true);
  });

  it("does not retry plain programming errors", () => {
    expect(isRetryableError(new TypeError("undefined is not a function"))).toBe(false);
    expect(isRetryableError(undefined)).toBe(false);
  });
});
