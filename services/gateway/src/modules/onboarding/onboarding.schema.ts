import { z } from "zod";

export const onboardingBodySchema = z.object({
  action: z.enum(["save", "complete"]),
  data: z.record(z.string(), z.unknown()),
  tempId: z.coerce.number().int().positive().optional(),
});

export type OnboardingBody = z.infer<typeof onboardingBodySchema>;
