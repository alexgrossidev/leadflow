import { z } from "zod";
import { paginationQuerySchema } from "#core/schemas/pagination";

export const requestUploadBodySchema = z.object({
  filename: z.string().trim().min(1).max(255),
  contentType: z.string().trim().min(1).max(255),
});

export const customFieldSettingsSchema = z.object({
  fieldsToDelete: z.array(z.string()),
  merges: z.array(
    z.object({
      fieldName: z.string().min(1),
      target: z.string().min(1),
    }),
  ),
  import: z.array(z.string()),
});

export const launchImportBodySchema = z.object({
  /** The `storageKey` returned by the upload-url endpoint. */
  objPath: z.string().trim().min(1).max(1024),
  customfieldSettings: customFieldSettingsSchema,
});

export const listImportsQuerySchema = z.object({
  type: z.enum(["customer", "lead"]).default("customer"),
});

export const importReportQuerySchema = paginationQuerySchema;

export type CustomFieldSettings = z.infer<typeof customFieldSettingsSchema>;
