import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { UnrecoverableWhatsappError } from "#transport/whatsapp.errors";
import { createTestService, type InMemorySessionRepository } from "./fakes";

const MAX = 5;

function seedActive(repo: InMemorySessionRepository, count: number) {
  for (let i = 0; i < count; i++) repo.seed({ businessId: 10_000 + i, userId: 1, status: "connected" });
}

describe("concurrent session cap", () => {
  it("rejects a new session with SESSION_LIMIT_EXCEEDED whenever the cap is already reached", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: MAX, max: MAX + 20 }), fc.integer({ min: 1, max: 9999 }), async (active, businessId) => {
        const { repo, transport, service } = createTestService({ maxConcurrentSessions: MAX });
        seedActive(repo, active);

        const error = await service.initSession(businessId, 7).catch((err: unknown) => err);

        expect(error).toBeInstanceOf(UnrecoverableWhatsappError);
        expect((error as UnrecoverableWhatsappError).code).toBe("SESSION_LIMIT_EXCEEDED");
        expect(repo.get(businessId, 7)).toBeUndefined();
        expect(transport.initSession).not.toHaveBeenCalled();
      }),
      { numRuns: 50 },
    );
  });

  it("starts a new session whenever there is a free slot", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: MAX - 1 }), fc.integer({ min: 1, max: 9999 }), async (active, businessId) => {
        const { repo, service } = createTestService({ maxConcurrentSessions: MAX });
        seedActive(repo, active);

        await service.initSession(businessId, 7);

        expect(repo.get(businessId, 7)!.status).toBe("connecting");
      }),
      { numRuns: 50 },
    );
  });

  it("re-initialising a session that already holds a slot is allowed at the cap", async () => {
    const { repo, service } = createTestService({ maxConcurrentSessions: MAX });
    seedActive(repo, MAX - 1);
    repo.seed({ businessId: 1, userId: 7, status: "qr_ready" });

    await expect(service.initSession(1, 7)).resolves.toMatchObject({ status: "connecting" });
  });

  it("concurrent inits for different tenants never exceed the cap", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: MAX }), fc.integer({ min: 1, max: 15 }), async (active, contenders) => {
        const { repo, transport, service } = createTestService({ maxConcurrentSessions: MAX });
        seedActive(repo, active);
        // Yield inside the transport call so the inits genuinely interleave.
        transport.initSession.mockImplementation(() => new Promise((resolve) => setImmediate(resolve)));

        const results = await Promise.allSettled(
          Array.from({ length: contenders }, (_, i) => service.initSession(i + 1, 7)),
        );

        const started = results.filter((r) => r.status === "fulfilled").length;
        expect(started).toBe(Math.min(contenders, MAX - active));
        expect(await repo.countActive()).toBeLessThanOrEqual(MAX);
      }),
      { numRuns: 50 },
    );
  });

  it("a second init for the same session while one is running is rejected as in progress", async () => {
    const { transport, service } = createTestService();
    transport.initSession.mockImplementation(() => new Promise((resolve) => setImmediate(resolve)));

    const [first, second] = await Promise.allSettled([service.initSession(1, 7), service.initSession(1, 7)]);

    expect(first.status).toBe("fulfilled");
    expect(second).toMatchObject({ status: "rejected", reason: { code: "SESSION_INIT_IN_PROGRESS" } });
  });
});
