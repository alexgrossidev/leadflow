import { status } from "@grpc/grpc-js";
import { describe, expect, it, vi } from "vitest";
import { GrpcError, toServiceError, withGlobalMiddleware } from "../core/error.interceptors.js";

describe("toServiceError", () => {
  it("passes through an intentional GrpcError", () => {
    const err = toServiceError(new GrpcError(status.NOT_FOUND, "lead 7 not found"));
    expect(err.code).toBe(status.NOT_FOUND);
    expect(err.details).toBe("lead 7 not found");
  });

  it("hides internal errors behind a generic INTERNAL", () => {
    const err = toServiceError(new Error("ER_ACCESS_DENIED_ERROR: user 'root'@'10.0.0.3'"));
    expect(err.code).toBe(status.INTERNAL);
    expect(err.details).toBe("Internal server error");
  });

  it("does not treat driver string codes as gRPC statuses", () => {
    const dbError = Object.assign(new Error("Duplicate entry"), { code: "ER_DUP_ENTRY" });
    expect(toServiceError(dbError).code).toBe(status.INTERNAL);
  });

  it("does not treat out-of-range numeric codes as gRPC statuses", () => {
    expect(toServiceError(Object.assign(new Error("x"), { code: 1062 })).code).toBe(status.INTERNAL);
  });
});

describe("withGlobalMiddleware", () => {
  it("reports unary failures through the callback", async () => {
    const wrapped = withGlobalMiddleware({ get: async () => { throw new GrpcError(status.INVALID_ARGUMENT, "bad id"); } });
    const callback = vi.fn();
    await (wrapped.get as (call: unknown, cb: unknown) => Promise<void>)({}, callback);
    expect(callback).toHaveBeenCalledWith(expect.objectContaining({ code: status.INVALID_ARGUMENT }));
  });

  it("destroys streams with a real Error carrying the status", async () => {
    const wrapped = withGlobalMiddleware({ stream: async () => { throw new Error("db down"); } });
    const call = { destroy: vi.fn() };
    await (wrapped.stream as (call: unknown) => Promise<void>)(call);
    const [err] = call.destroy.mock.calls[0]!;
    expect(err).toBeInstanceOf(Error);
    expect(err).toMatchObject({ code: status.INTERNAL });
  });

  it("does not touch the callback when the handler succeeds", async () => {
    const wrapped = withGlobalMiddleware({ ok: async () => {} });
    const callback = vi.fn();
    await (wrapped.ok as (call: unknown, cb: unknown) => Promise<void>)({}, callback);
    expect(callback).not.toHaveBeenCalled();
  });
});
