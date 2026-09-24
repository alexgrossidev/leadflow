import { describe, it, expect, vi, beforeEach } from "vitest";
import { AutomationSettingsService } from "../automationSettings.service.js";
import * as emitter from "#comms/bullmq/bullmq.eventEmitter";
import { eventNames } from "@leadflow/shared/eventBus";
import { DEFAULT_SETTINGS } from "../automationSettings.schema.js";

vi.mock("#comms/bullmq/bullmq.eventEmitter", () => ({
  emitToSender: vi.fn(),
}));

const validPayload = {
  validateForBusinessHours: true,
  inWarmUpMode: false,
  maxEmails: 100,
  maxWhatsapps: 50,
  toleranceRate: 10,
  minimumWaitBetweenMessages: 60,
};

describe("AutomationSettingsService", () => {
  let service: AutomationSettingsService;
  let emitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new AutomationSettingsService();
    emitSpy = vi.spyOn(emitter, "emitToSender").mockResolvedValue("job-1");
  });

  it("create calls emitToSender with SENDER_AUTOM_SETTINGS_CREATED and correct payload", async () => {
    await service.create(1, 2, validPayload);
    expect(emitSpy).toHaveBeenCalledWith(
      eventNames.SENDER_AUTOM_SETTINGS_CREATED,
      { userId: 2, businessId: 1, settings: validPayload },
    );
  });

  it("update calls emitToSender with SENDER_AUTOM_SETTINGS_UPDATED and correct payload", async () => {
    await service.update(1, 2, validPayload);
    expect(emitSpy).toHaveBeenCalledWith(
      eventNames.SENDER_AUTOM_SETTINGS_UPDATED,
      { userId: 2, businessId: 1, settings: validPayload },
    );
  });

  it("delete calls emitToSender with SENDER_AUTOM_SETTINGS_DELETED and default settings", async () => {
    await service.delete(1, 2);
    expect(emitSpy).toHaveBeenCalledWith(
      eventNames.SENDER_AUTOM_SETTINGS_DELETED,
      { userId: 2, businessId: 1, settings: DEFAULT_SETTINGS },
    );
  });
});
