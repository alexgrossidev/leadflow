import { z } from "zod";

const customFieldsSchema = z
  .record(z.string().trim().min(1).max(64), z.string().max(2000))
  .refine((fields) => Object.keys(fields).length <= 100, {
    message: "At most 100 custom fields",
  });

const nullableText = (max: number) => z.string().trim().max(max).nullable().optional();

/** Contract #1: `POST /internal/leads`, called by lead-ingestion. */
export const leadIntakeSchema = z.object({
  businessId: z.number().int().positive(),
  userId: z.number().int().positive(),
  source: z.enum(["facebook", "google_forms"]),
  externalId: z.string().trim().min(1).max(255),
  fullName: nullableText(255),
  email: z.email().max(255).nullable().optional(),
  phone: nullableText(50),
  fields: customFieldsSchema.optional(),
  createdAt: z.iso.datetime({ offset: true }).optional(),
});

export type LeadIntake = z.infer<typeof leadIntakeSchema>;

const leadFieldsSchema = z.object({
  name: nullableText(255),
  company: nullableText(255),
  address: nullableText(1000),
  city: nullableText(255),
  postcode: nullableText(32),
  email: z.email().max(255).nullable().optional(),
  phone: nullableText(50),
  status: nullableText(100),
  status_color: nullableText(50),
  value: nullableText(100),
  notes: nullableText(10_000),
  category: nullableText(255),
  probability: z.number().int().min(0).max(100).nullable().optional(),
  duedate: z.coerce.date().nullable().optional(),
  customFields: customFieldsSchema.optional(),
});

/** Manual create from the UI. Tenant ids come from the URL, never the body. */
export const createLeadBodySchema = leadFieldsSchema;
export const updateLeadBodySchema = leadFieldsSchema
  .extend({ archived: z.boolean().optional() })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });

export type CreateLeadBody = z.infer<typeof createLeadBodySchema>;
export type UpdateLeadBody = z.infer<typeof updateLeadBodySchema>;
