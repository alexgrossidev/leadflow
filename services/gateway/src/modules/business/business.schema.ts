import { z } from "zod";
import { createInsertSchema } from "drizzle-zod";
import { businesses } from "./business.table.js";

// Ownership and bookkeeping columns are never client-writable: the owner comes
// from the access token, ids and timestamps from the database.
const writableBusinessSchema = createInsertSchema(businesses).omit({
  id: true,
  userId: true,
  created_at: true,
  updated_at: true,
});

export const createBusinessSchema = writableBusinessSchema.strict();
export const updateBusinessSchema = writableBusinessSchema.partial().strict();

export type CreateBusinessInput = z.infer<typeof createBusinessSchema>;
export type UpdateBusinessInput = z.infer<typeof updateBusinessSchema>;
