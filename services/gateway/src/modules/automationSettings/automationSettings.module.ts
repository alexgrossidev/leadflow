import { AutomationSettingsService } from "./automationSettings.service.js";
import { AutomationSettingsController } from "./automationSettings.controller.js";

export const automationSettingsController = new AutomationSettingsController(
  new AutomationSettingsService(),
);
