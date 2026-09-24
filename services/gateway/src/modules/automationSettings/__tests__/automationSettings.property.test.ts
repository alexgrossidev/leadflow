import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fc from "fast-check";
import { ZodError } from "zod";
import { AutomationSettingsService } from "../automationSettings.service.js";
import * as emitter from "#comms/bullmq/bullmq.eventEmitter";
import { eventNames } from "@leadflow/shared/eventBus";
import { automationSettingsBodySchema } from "../automationSettings.schema.js";

vi.mock("#comms/bullmq/bullmq.eventEmitter", () => ({
  emitToSender: vi.fn(),
}));

// Arbitrary for valid settings payloads
const validSettingsArbitrary = fc.record({
  validateForBusinessHours: fc.boolean(),
  inWarmUpMode: fc.boolean(),
  maxEmails: fc.integer({ min: 1, max: 1000 }),
  maxWhatsapps: fc.integer({ min: 1, max: 200 }),
  toleranceRate: fc.integer({ min: 0, max: 100 }),
  minimumWaitBetweenMessages: fc.integer({ min: 1, max: 3600 }),
});

// Arbitrary for invalid settings payloads (at least one field out of range)
const invalidSettingsArbitrary = fc.oneof(
  // maxWhatsapps out of range
  fc.record({
    validateForBusinessHours: fc.boolean(),
    inWarmUpMode: fc.boolean(),
    maxEmails: fc.integer({ min: 1, max: 1000 }),
    maxWhatsapps: fc.oneof(fc.integer({ max: 0 }), fc.integer({ min: 201 })),
    toleranceRate: fc.integer({ min: 0, max: 100 }),
    minimumWaitBetweenMessages: fc.integer({ min: 1, max: 3600 }),
  }),
  // maxEmails out of range
  fc.record({
    validateForBusinessHours: fc.boolean(),
    inWarmUpMode: fc.boolean(),
    maxEmails: fc.oneof(fc.integer({ max: 0 }), fc.integer({ min: 1001 })),
    maxWhatsapps: fc.integer({ min: 1, max: 200 }),
    toleranceRate: fc.integer({ min: 0, max: 100 }),
    minimumWaitBetweenMessages: fc.integer({ min: 1, max: 3600 }),
  }),
  // toleranceRate out of range
  fc.record({
    validateForBusinessHours: fc.boolean(),
    inWarmUpMode: fc.boolean(),
    maxEmails: fc.integer({ min: 1, max: 1000 }),
    maxWhatsapps: fc.integer({ min: 1, max: 200 }),
    toleranceRate: fc.oneof(fc.integer({ max: -1 }), fc.integer({ min: 101 })),
    minimumWaitBetweenMessages: fc.integer({ min: 1, max: 3600 }),
  }),
  // minimumWaitBetweenMessages out of range
  fc.record({
    validateForBusinessHours: fc.boolean(),
    inWarmUpMode: fc.boolean(),
    maxEmails: fc.integer({ min: 1, max: 1000 }),
    maxWhatsapps: fc.integer({ min: 1, max: 200 }),
    toleranceRate: fc.integer({ min: 0, max: 100 }),
    minimumWaitBetweenMessages: fc.oneof(fc.integer({ max: 0 }), fc.integer({ min: 3601 })),
  }),
);

describe("AutomationSettings property tests", () => {
  let service: AutomationSettingsService;
  let emitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AutomationSettingsService();
    emitSpy = vi.spyOn(emitter, "emitToSender").mockResolvedValue("job-1");
  });

  it("accepts and emits every valid settings payload", async () => {
    await fc.assert(
      fc.asyncProperty(validSettingsArbitrary, async (settings) => {
        emitSpy.mockClear();
        await service.create(1, 1, settings);
        expect(emitSpy).toHaveBeenCalledOnce();
        expect(emitSpy).toHaveBeenCalledWith(
          eventNames.SENDER_AUTOM_SETTINGS_CREATED,
          expect.objectContaining({ settings }),
        );
      }),
      { numRuns: 100 },
    );
  });

  it("rejects every out-of-range settings payload before emission", () => {
    fc.assert(
      fc.property(invalidSettingsArbitrary, (settings) => {
        expect(() => automationSettingsBodySchema.parse(settings)).toThrow(ZodError);
        expect(emitSpy).not.toHaveBeenCalled();
      }),
      { numRuns: 100 },
    );
  });
});
