import { z } from "zod";

export const loginBodySchema = z.object({
  /** Username or email address. */
  username: z.string().trim().min(1).max(255),
  password: z.string().min(1).max(200),
});

export type LoginBody = z.infer<typeof loginBodySchema>;
