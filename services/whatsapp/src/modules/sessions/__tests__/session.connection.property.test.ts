import { describe, it, expect } from "vitest";
import * as fc from "fast-check";
import { createTestService } from "./fakes";

const id = fc.integer({ min: 1, max: 9999 });

describe("session state machine", () => {
  it("only an authenticated callback marks a session connected", async () => {
    await fc.assert(
      fc.asyncProperty(fc.constantFrom("qr", "qr_scanned", "disconnected" as const), id, id, async (event, businessId, userId) => {
        const { repo, service } = createTestService();
        repo.seed({ businessId, userId, status: "qr_ready", qrCode: "data:image/png;base64,abc", qrExpiresAt: new Date(Date.now() + 60_000) });

        await service.handleCallback({ event, businessId, userId, ...(event === "qr" ? { qr: "data:image/png;base64,new" } : {}) });

        const stored = repo.get(businessId, userId)!;
        expect(stored.status).not.toBe("connected");
        expect(stored.connectedAt).toBeNull();
      }),
      { numRuns: 100 },
    );
  });

  it("an authenticated callback after a QR scan connects the session and records connected_at", async () => {
    await fc.assert(
      fc.asyncProperty(id, id, async (businessId, userId) => {
        const { repo, service } = createTestService();
        repo.seed({ businessId, userId, status: "qr_scanned" });

        await service.handleCallback({ event: "authenticated", businessId, userId });

        const stored = repo.get(businessId, userId)!;
        expect(stored.status).toBe("connected");
        expect(stored.connectedAt).toBeInstanceOf(Date);
        expect(stored.qrCode).toBeNull();
      }),
      { numRuns: 100 },
    );
  });

  it("a QR scan clears the stored QR without connecting", async () => {
    await fc.assert(
      fc.asyncProperty(id, id, fc.string({ minLength: 10, maxLength: 200 }), async (businessId, userId, qr) => {
        const { repo, service } = createTestService();
        repo.seed({ businessId, userId, status: "qr_ready", qrCode: qr, qrExpiresAt: new Date(Date.now() + 60_000) });

        await service.handleCallback({ event: "qr_scanned", businessId, userId });

        const stored = repo.get(businessId, userId)!;
        expect(stored).toMatchObject({ status: "qr_scanned", qrCode: null, qrExpiresAt: null, connectedAt: null });
      }),
      { numRuns: 100 },
    );
  });

  it("ignores a cached-browser login webhook that arrives right after a fresh init", async () => {
    const { repo, service } = createTestService();
    repo.seed({ businessId: 1, userId: 2, status: "connecting", connectedAt: null });

    await service.handleCallback({ event: "authenticated", businessId: 1, userId: 2 });

    expect(repo.get(1, 2)!.status).toBe("connecting");
  });

  it("accepts a login webhook without a QR when resuming a previously connected session", async () => {
    const { repo, service } = createTestService();
    repo.seed({ businessId: 1, userId: 2, status: "connecting", connectedAt: new Date(Date.now() - 3_600_000) });

    await service.handleCallback({ event: "authenticated", businessId: 1, userId: 2 });

    expect(repo.get(1, 2)!.status).toBe("connected");
  });

  it("a late qrcode webhook never downgrades a connected or closed session", async () => {
    for (const status of ["connected", "closed"] as const) {
      const { repo, service } = createTestService();
      repo.seed({ businessId: 1, userId: 2, status });

      await service.handleCallback({ event: "qr", businessId: 1, userId: 2, qr: "data:image/png;base64,late" });

      expect(repo.get(1, 2)).toMatchObject({ status, qrCode: null });
    }
  });
});
