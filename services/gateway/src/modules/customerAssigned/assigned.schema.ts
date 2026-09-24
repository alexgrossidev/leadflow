import { z } from "zod";

export const assignServiceBodySchema = z.object({
  serviceId: z.number().int().positive(),
});

export const replaceServicesBodySchema = z.object({
  serviceIds: z.array(z.number().int().positive()).max(100),
});
