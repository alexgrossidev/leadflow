import { z } from "zod";
import { createInsertSchema } from "drizzle-zod";
import { automations } from "./automation.table.js";
import { automationSteps } from "./automation.step.table.js";

// Ids, ownership and timestamps are server-controlled and stripped from input.
const stepInputSchema = createInsertSchema(automationSteps)
  .omit({ automation_id: true, created_at: true, updated_at: true })
  .extend({
    /** Present when editing an existing step of this automation. */
    id: z.number().int().positive().optional(),
  });

export const automationBodySchema = createInsertSchema(automations)
  .omit({ id: true, user_id: true, business_id: true, created_at: true })
  .extend({
    steps: z.array(stepInputSchema).min(1, "At least one step is required").max(50),
  });

export const pauseBodySchema = z.object({ paused: z.boolean() });

export type AutomationBody = z.infer<typeof automationBodySchema>;
export type StepInput = z.infer<typeof stepInputSchema>;
