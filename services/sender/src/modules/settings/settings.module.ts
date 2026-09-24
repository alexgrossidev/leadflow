import { SettingsRepository } from "./settings.repo";
import { SettingsService } from "./settings.service";

export const settingsService = new SettingsService(new SettingsRepository());
