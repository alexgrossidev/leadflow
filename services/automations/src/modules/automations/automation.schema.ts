import { z } from "zod";
import { normaliseOperator } from "./automation.rules";
import { parseDelayUnit } from "../automationTargets/target.schedule";

const nullableText = z.string().nullish().transform((v) => v ?? null);

const operatorSchema = z
  .string()
  .nullish()
  .transform((raw, ctx) => {
    if (raw == null || raw === "") return null;
    const op = normaliseOperator(raw);
    if (!op) {
      ctx.addIssue({ code: "custom", message: `Unsupported operator: ${raw}` });
      return z.NEVER;
    }
    return op;
  });

const delayUnitSchema = z
  .string()
  .nullish()
  .transform((raw, ctx) => {
    if (raw == null || raw === "") return "minute";
    const unit = parseDelayUnit(raw);
    if (!unit) {
      ctx.addIssue({ code: "custom", message: `Unsupported delay unit: ${raw}` });
      return z.NEVER;
    }
    return unit;
  });

const stepSchema = z.object({
  title: nullableText,
  description: nullableText,
  stepType: z.enum(["email", "whatsapp"]),
  subject: nullableText,
  content: nullableText,
  attachments: nullableText,
  delay: z.coerce.number().int().min(0).nullish().transform((v) => v ?? 0),
  delay_unit: delayUnitSchema,
  step_sequence: z.coerce.number().int().positive().nullish(),
});

/**
 * The `automation` object carried by automation.created / automation.updated.
 * Validated at the boundary because the shared contract types it as `any`.
 */
export const automationPayloadSchema = z
  .object({
    id: z.coerce.number().int().positive(),
    user_id: z.coerce.number().int().positive(),
    business_id: z.coerce.number().int().positive(),
    name: z.string().min(1),
    automationType: z.enum(["lead", "customer"]).nullish().transform((v) => v ?? "lead"),
    paused: z.boolean().nullish().transform((v) => v ?? false),
    field: nullableText,
    operator: operatorSchema,
    value: nullableText,
    steps: z.array(stepSchema).min(1),
  })
  .transform(({ steps, ...automation }, ctx) => {
    // Steps without an explicit sequence take their position in the list.
    const sequenced = steps
      .map((step, index) => ({ ...step, step_sequence: step.step_sequence ?? index + 1 }))
      .sort((a, b) => a.step_sequence - b.step_sequence);
    const sequences = sequenced.map((step) => step.step_sequence);
    if (new Set(sequences).size !== sequences.length) {
      ctx.addIssue({ code: "custom", path: ["steps"], message: "step_sequence values must be unique" });
      return z.NEVER;
    }
    return { ...automation, steps: sequenced };
  });

export type AutomationPayload = z.infer<typeof automationPayloadSchema>;
