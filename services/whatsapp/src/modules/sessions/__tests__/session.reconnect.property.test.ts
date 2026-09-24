import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import * as fc from "fast-check";
import { createTestService } from "./fakes";

describe("reconnect after a dropped session", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("makes exactly maxReconnectAttempts attempts, then marks the session failed", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 10 }), fc.integer({ min: 1, max: 9999 }), async (attempts, businessId) => {
        const { repo, transport, service } = createTestService({ maxReconnectAttempts: attempts });
        transport.initSession.mockRejectedValue(new Error("transport unavailable"));
        repo.seed({ businessId, userId: 1, status: "disconnected", disconnectedAt: new Date() });

        const done = service.reconnect(businessId, 1);
        await vi.runAllTimersAsync();
        await done;

        expect(transport.initSession).toHaveBeenCalledTimes(attempts);
        expect(repo.get(businessId, 1)!.status).toBe("failed");
      }),
      { numRuns: 50 },
    );
  });

  // Regression: the handler used to set disconnected_at = now and then re-read
  // the row, so "disconnected less than 5 s ago" was always true and no
  // unexpected disconnect ever reconnected.
  it("an unexpected disconnect of a connected session triggers a reconnect", async () => {
    const { repo, transport, service } = createTestService();
    repo.seed({ businessId: 1, userId: 2, status: "connected", connectedAt: new Date() });

    await service.handleCallback({ event: "disconnected", businessId: 1, userId: 2, disconnectReason: "browserClose" });
    await vi.runAllTimersAsync();

    expect(transport.initSession).toHaveBeenCalledTimes(1);
    expect(repo.get(1, 2)!.status).toBe("connecting");
  });

  it("duplicate disconnect webhooks for one drop start a single reconnect loop", async () => {
    const { repo, transport, service } = createTestService();
    repo.seed({ businessId: 1, userId: 2, status: "connected", connectedAt: new Date() });

    await service.handleCallback({ event: "disconnected", businessId: 1, userId: 2, disconnectReason: "browserClose" });
    await service.handleCallback({ event: "disconnected", businessId: 1, userId: 2 });
    await vi.runAllTimersAsync();

    expect(transport.initSession).toHaveBeenCalledTimes(1);
  });

  it("a phone logout followed by browserClose does not reconnect", async () => {
    const { repo, transport, service } = createTestService();
    repo.seed({ businessId: 1, userId: 2, status: "connected", connectedAt: new Date() });

    await service.handleCallback({ event: "disconnected", businessId: 1, userId: 2, disconnectReason: "disconnectedMobile" });
    await service.handleCallback({ event: "disconnected", businessId: 1, userId: 2, disconnectReason: "browserClose" });
    await vi.runAllTimersAsync();

    expect(transport.initSession).not.toHaveBeenCalled();
    expect(repo.get(1, 2)!.status).toBe("disconnected");
  });

  it("closing a session deliberately does not reconnect when the transport reports the close", async () => {
    const { repo, transport, service } = createTestService();
    repo.seed({ businessId: 1, userId: 2, status: "connected", connectedAt: new Date() });

    await service.closeSession(1, 2);
    await service.handleCallback({ event: "disconnected", businessId: 1, userId: 2, disconnectReason: "browserClose" });
    await vi.runAllTimersAsync();

    expect(transport.initSession).not.toHaveBeenCalled();
    expect(repo.get(1, 2)!.status).toBe("closed");
  });

  it("stops reconnecting once the session has been re-initiated by someone else", async () => {
    const { repo, transport, service } = createTestService();
    transport.initSession.mockRejectedValue(new Error("transport unavailable"));
    const row = repo.seed({ businessId: 1, userId: 2, status: "disconnected" });

    const done = service.reconnect(1, 2);
    await vi.advanceTimersByTimeAsync(1_000); // first attempt fails
    await repo.resetToConnecting(row.id);
    await vi.runAllTimersAsync();
    await done;

    expect(transport.initSession).toHaveBeenCalledTimes(1);
    expect(repo.get(1, 2)!.status).toBe("connecting");
  });
});
