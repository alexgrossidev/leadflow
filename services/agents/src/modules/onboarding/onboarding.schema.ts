import { z } from "zod";

/** External tenant ids are owned by the gateway, validated as opaque ids. */
const tenantIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9_-]+$/, "Ids may only contain [A-Za-z0-9_-]");

const FIELD_MAX_CHARS = 10_000;
const MAX_FIELDS = 50;

/**
 * One onboarding submission. `userId` is the initiating owner, bound from the
 * trigger. `businessId` is optional: business_info creates it during the run.
 * `inputs` is an open map of field key to free-form text, so new fields need
 * no schema change here; the registry decides which keys are understood.
 */
export const onboardingSchema = z
  .object({
    userId: tenantIdSchema,
    businessId: tenantIdSchema.optional(),
    locale: z.string().min(2).max(10).default("en"),
    inputs: z
      .record(z.string().min(1).max(64), z.string().min(1).max(FIELD_MAX_CHARS))
      .refine((inputs) => Object.keys(inputs).length > 0, {
        message: "inputs must contain at least one field",
      })
      .refine((inputs) => Object.keys(inputs).length <= MAX_FIELDS, {
        message: `inputs must contain at most ${MAX_FIELDS} fields`,
      }),
  })
  .strict();

/** The `Idempotency-Key` header: required, so a client retry can never double-create. */
export const idempotencyKeySchema = z
  .string({ error: "Idempotency-Key header is required" })
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_.:-]+$/, "Idempotency-Key may only contain [A-Za-z0-9_.:-]");

export type OnboardingRequest = z.output<typeof onboardingSchema>;
