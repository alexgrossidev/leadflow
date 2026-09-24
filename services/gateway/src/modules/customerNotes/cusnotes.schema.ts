import { z } from "zod";

export const createNoteBodySchema = z.object({
  title: z.string().trim().min(1).max(255),
  description: z.string().trim().min(1).max(10_000),
  idempotencyKey: z.string().min(1).max(128).optional(),
});

export const updateNoteBodySchema = createNoteBodySchema
  .pick({ title: true, description: true })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });

export type CreateNoteBody = z.infer<typeof createNoteBodySchema>;
export type UpdateNoteBody = z.infer<typeof updateNoteBodySchema>;
