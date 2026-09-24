import { afterEach, describe, it, expect, vi } from "vitest";
import * as fc from "fast-check";
import { QR_MAX_REFRESH_FAILURES, QR_REFRESH_COOLDOWN_MS, QR_TTL_SECONDS } from "../session.constants";
import { createTestService } from "./fakes";

const id = fc.integer({ min: 1, max: 9999 });
const QR_TTL_MS = QR_TTL_SECONDS * 1000;

describe("QR lifecycle", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("a stored QR expires exactly QR_TTL_SECONDS after the qrcode webhook", async () => {
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 10, maxLength: 200 }), id, id, async (qr, businessId, userId) => {
        const { repo, service } = createTestService();
        repo.seed({ businessId, userId, status: "connecting" });

        const before = Date.now();
        await service.handleCallback({ event: "qr", businessId, userId, qr });
        const after = Date.now();

        const stored = repo.get(businessId, userId)!;
        expect(stored.status).toBe("qr_ready");
        expect(stored.qrCode).toBe(qr);
        expect(stored.qrExpiresAt!.getTime()).toBeGreaterThanOrEqual(before + QR_TTL_MS);
        expect(stored.qrExpiresAt!.getTime()).toBeLessThanOrEqual(after + QR_TTL_MS);
      }),
      { numRuns: 100 },
    );
  });

  it("getQr reports the whole seconds left before a valid QR expires", async () => {
    vi.useFakeTimers();
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: QR_TTL_MS }), id, id, async (msLeft, businessId, userId) => {
        const { repo, service } = createTestService();
        repo.seed({ businessId, userId, status: "qr_ready", qrCode: "qr", qrExpiresAt: new Date(Date.now() + msLeft) });

        const result = await service.getQr(businessId, userId);

        expect(result).toEqual({ qr: "qr", expiresIn: Math.floor(msLeft / 1000) });
      }),
      { numRuns: 100 },
    );
  });

  it("repeated polls of an expired QR restart the transport session at most once per cooldown", async () => {
    vi.useFakeTimers();
    const { repo, transport, service } = createTestService();
    repo.seed({ businessId: 1, userId: 2, status: "qr_ready", qrCode: "old", qrExpiresAt: new Date(Date.now() - 1) });

    for (let poll = 0; poll < 10; poll++) {
      expect(await service.getQr(1, 2)).toBeNull();
      await vi.advanceTimersByTimeAsync(1_000);
    }
    expect(transport.initSession).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(QR_REFRESH_COOLDOWN_MS);
    await service.getQr(1, 2);
    expect(transport.initSession).toHaveBeenCalledTimes(2);
  });

  it("marks the session failed after QR_MAX_REFRESH_FAILURES consecutive refresh failures", async () => {
    vi.useFakeTimers();
    const { repo, transport, service } = createTestService();
    transport.initSession.mockRejectedValue(new Error("transport down"));
    repo.seed({ businessId: 1, userId: 2, status: "qr_ready", qrCode: "old", qrExpiresAt: new Date(Date.now() - 1) });

    for (let i = 1; i < QR_MAX_REFRESH_FAILURES; i++) {
      await service.getQr(1, 2);
      expect(repo.get(1, 2)!.status).toBe("qr_ready");
      await vi.advanceTimersByTimeAsync(QR_REFRESH_COOLDOWN_MS);
    }
    await service.getQr(1, 2);

    expect(repo.get(1, 2)!.status).toBe("failed");
  });
});
