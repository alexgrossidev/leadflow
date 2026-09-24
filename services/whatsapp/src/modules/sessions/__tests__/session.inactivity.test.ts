import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { createTestService } from "./fakes";

const TIMEOUT = 10_000;

describe("inactivity timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("closes a session that sees no activity for the whole timeout", async () => {
    const { repo, transport, service } = createTestService({ inactivityTimeoutMs: TIMEOUT });
    repo.seed({ businessId: 1, userId: 2, status: "connected" });

    await service.recordActivity(1, 2);
    await vi.advanceTimersByTimeAsync(TIMEOUT + 1);

    expect(repo.get(1, 2)!.status).toBe("closed");
    expect(transport.closeSession).toHaveBeenCalledTimes(1);
  });

  it("keeps a busy session open while messages keep being sent", async () => {
    const { repo, service } = createTestService({ inactivityTimeoutMs: TIMEOUT });
    repo.seed({ businessId: 1, userId: 2, status: "connected" });

    await service.recordActivity(1, 2);
    for (let i = 0; i < 5; i++) {
      await vi.advanceTimersByTimeAsync(TIMEOUT * 0.8);
      await service.recordActivity(1, 2); // a send
    }

    expect(repo.get(1, 2)!.status).toBe("connected");
  });

  it("activity recorded on another replica postpones this replica's timer", async () => {
    const shared = createTestService({ inactivityTimeoutMs: TIMEOUT });
    shared.repo.seed({ businessId: 1, userId: 2, status: "connected" });

    await shared.service.recordActivity(1, 2); // replica A arms its timer
    await vi.advanceTimersByTimeAsync(TIMEOUT * 0.8);
    // Another replica sends a message: it only touches the shared (Redis) marker.
    await shared.coordinator.recordActivity(1, 2, TIMEOUT);
    await vi.advanceTimersByTimeAsync(TIMEOUT * 0.5);

    expect(shared.repo.get(1, 2)!.status).toBe("connected");

    await vi.advanceTimersByTimeAsync(TIMEOUT);
    expect(shared.repo.get(1, 2)!.status).toBe("closed");
  });
});
