import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fc from "fast-check";

vi.mock("#modules/sessions/session.service", () => ({
  sessionService: {
    initSession: vi.fn(),
    closeSession: vi.fn(),
  },
}));

import { NUMBER_ADDED } from "../number.ADDED";
import { NUMBER_REMOVED } from "../number.REMOVED";
import { sessionService } from "#modules/sessions/session.service";
import type { SessionRow } from "#modules/sessions/session.table";

const whatsappNumber = fc.record({
  businessId: fc.integer({ min: 1 }),
  userId: fc.integer({ min: 1 }),
  phoneNumber: fc.string({ minLength: 1 }),
});

describe("whatsapp number events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("adding a number starts the session of exactly that (businessId, userId)", async () => {
    await fc.assert(
      fc.asyncProperty(whatsappNumber, async (payload) => {
        vi.mocked(sessionService.initSession).mockResolvedValue({ id: 1 } as SessionRow);

        await NUMBER_ADDED(payload);

        expect(sessionService.initSession).toHaveBeenLastCalledWith(payload.businessId, payload.userId);
      }),
      { numRuns: 100 },
    );
  });

  it("removing a number closes the session of exactly that (businessId, userId)", async () => {
    await fc.assert(
      fc.asyncProperty(whatsappNumber, async (payload) => {
        vi.mocked(sessionService.closeSession).mockResolvedValue(undefined);

        await NUMBER_REMOVED(payload);

        expect(sessionService.closeSession).toHaveBeenLastCalledWith(payload.businessId, payload.userId);
      }),
      { numRuns: 100 },
    );
  });

  it("a failed session start is rethrown so the event bus retries it", async () => {
    vi.mocked(sessionService.initSession).mockRejectedValue(new Error("transport down"));

    await expect(NUMBER_ADDED({ businessId: 1, userId: 2, phoneNumber: "+1555" })).rejects.toThrow("transport down");
  });
});
