import { z } from "zod";

export const automationSettingsBodySchema = z.object({
  validateForBusinessHours: z.boolean(),
  inWarmUpMode: z.boolean(),
  maxEmails: z.number().int().min(1).max(1000),
  maxWhatsapps: z.number().int().min(1).max(200),
  toleranceRate: z.number().int().min(0).max(100),
  minimumWaitBetweenMessages: z.number().int().min(1).max(3600),
});

export type AutomationSettingsBody = z.infer<typeof automationSettingsBodySchema>;

export const DEFAULT_SETTINGS: AutomationSettingsBody = {
  validateForBusinessHours: false,
  inWarmUpMode: false,
  maxEmails: 100,
  maxWhatsapps: 100,
  toleranceRate: 10,
  minimumWaitBetweenMessages: 60,
};
