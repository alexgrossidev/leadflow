import { z } from "zod";
import { paginationQuerySchema } from "#core/schemas/pagination";

// Request bodies never carry businessId/userId: the tenant comes from the
// authenticated request context (see core/http/request-context.ts). Unknown
// keys are stripped by zod, so a client-supplied businessId is simply ignored.

const customFieldInputSchema = z.object({
  fieldSlug: z.string().trim().min(1).max(255),
  value: z.string().max(65_535).nullable(),
});

export const createCustomerBodySchema = z.object({
  customer: z.object({
    name: z.string().trim().min(1).max(255).nullable().optional(),
    email: z.email().max(255).toLowerCase().nullable().optional(),
    phone: z.string().trim().max(100).nullable().optional(),
  }),
  customFields: z.array(customFieldInputSchema).max(200).default([]),
});

export const updateCustomerBodySchema = z.object({
  customer: z
    .object({
      name: z.string().trim().min(1).max(255),
      email: z.email().max(255).toLowerCase(),
      phone: z.string().trim().max(100),
    })
    .partial()
    .default({}),
  customFields: z.array(customFieldInputSchema).max(200).default([]),
});

export type CreateCustomerBody = z.infer<typeof createCustomerBodySchema>;
export type UpdateCustomerBody = z.infer<typeof updateCustomerBodySchema>;

export const filterOperatorSchema = z.enum([
  "EQUAL",
  "CONTAINS",
  "NOT_NULL",
  "GREATER_THAN",
]);

export type FilterOperator = z.infer<typeof filterOperatorSchema>;

export const eavFilterSchema = z
  .object({
    fieldSlug: z.string().trim().min(1).max(255),
    operator: filterOperatorSchema,
    value: z.string().max(1000).nullable().optional(),
  })
  .refine((f) => f.operator === "NOT_NULL" || (f.value != null && f.value !== ""), {
    message: "value is required for this operator",
    path: ["value"],
  });

export type EavFilter = z.infer<typeof eavFilterSchema>;

export const customerSearchQuerySchema = paginationQuerySchema.extend({
  name: z.string().trim().max(255).optional(),
  /** What `name` matches: the customer's name, an assigned service, or a document. */
  searchType: z.enum(["name", "service", "attachment"]).default("name"),
  eavFilters: z.array(eavFilterSchema).max(20).default([]),
});

export type CustomerSearchQuery = z.infer<typeof customerSearchQuerySchema>;

export const customFieldBodySchema = z.object({
  field: z.string().trim().min(1).max(255),
});
