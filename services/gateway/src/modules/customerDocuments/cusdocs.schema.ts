import { z } from "zod";

export const requestUploadBodySchema = z.object({
  filename: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(255),
});

export const createDocumentBodySchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  /** The `storageKey` returned by the upload-url endpoint. */
  filePath: z.string().trim().min(1).max(1024),
  fileType: z.string().trim().min(1).max(255),
  fileSizeInBytes: z.number().int().positive(),
  note: z.string().max(3000).nullable().optional(),
  idempotencyKey: z.string().min(1).max(128).optional(),
});

export const updateDocumentBodySchema = z
  .object({
    fileName: z.string().trim().min(1).max(255),
    note: z.string().max(3000).nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });

export type CreateDocumentBody = z.infer<typeof createDocumentBodySchema>;
export type UpdateDocumentBody = z.infer<typeof updateDocumentBodySchema>;
