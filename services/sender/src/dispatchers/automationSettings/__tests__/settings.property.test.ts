import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fc from "fast-check";
import { SETTINGS_UPSERT } from "../settings.UPSERT";
import { SETTINGS_DELETE } from "../settings.DELETE";
import { defaultSettings } from "../../../config/constants";

// Mock the settings module singleton
vi.mock("../../../modules/settings/settings.module", () => {
  const store = new Map<number, Record<string, unknown>>();

  const settingsService = {
    upsert: vi.fn(async (payload: { businessId: number; settings: Record<string, unknown> }) => {
      store.set(payload.businessId, { ...payload.settings, businessId: payload.businessId });
    }),
    delete: vi.fn(async (businessId: number) => {
      store.delete(businessId);
    }),
    getForBusiness: vi.fn(async (businessId: number) => {
      return store.get(businessId) ?? { ...defaultSettings, businessId };
    }),
    _store: store,
  };

  return { settingsService };
});

// Import after mock is set up
import { settingsService } from "../../../modules/settings/settings.module";

// Arbitrary for valid senderAutomSettingsPayload
const validSettingsPayloadArbitrary = fc.record({
  userId: fc.integer({ min: 1 }),
  businessId: fc.integer({ min: 1 }),
  settings: fc.record({
    validateForBusinessHours: fc.boolean(),
    inWarmUpMode: fc.boolean(),
    maxEmails: fc.integer({ min: 1, max: 1000 }),
    maxWhatsapps: fc.integer({ min: 1, max: 200 }),
    toleranceRate: fc.integer({ min: 0, max: 100 }),
    minimumWaitBetweenMessages: fc.integer({ min: 1, max: 3600 }),
  }),
});

describe("Settings dispatcher property tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear the in-memory store between tests
    (settingsService as unknown as { _store: Map<number, unknown> })._store.clear();
  });

  it("upsert round-trip: the stored record matches the payload settings", async () => {
    await fc.assert(
      fc.asyncProperty(validSettingsPayloadArbitrary, async (payload) => {
        await SETTINGS_UPSERT(payload);

        expect(settingsService.upsert).toHaveBeenCalledWith(payload);

        const stored = await settingsService.getForBusiness(payload.businessId);
        expect(stored).toMatchObject({
          businessId: payload.businessId,
          ...payload.settings,
        });
      }),
      { numRuns: 100 },
    );
  });

  it("delete then read falls back to the default settings", async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1 }), async (businessId) => {
        const deletePayload = {
          userId: 1,
          businessId,
          settings: { ...defaultSettings },
        };

        await SETTINGS_DELETE(deletePayload);

        expect(settingsService.delete).toHaveBeenCalledWith(businessId);

        const result = await settingsService.getForBusiness(businessId);
        expect(result).toMatchObject({ ...defaultSettings, businessId });
      }),
      { numRuns: 100 },
    );
  });
});
