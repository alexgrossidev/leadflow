import { z } from "zod";

// E.164: "+" followed by up to 15 digits.
export const phoneNumberSchema = z.string().trim().regex(/^\+[1-9]\d{6,14}$/, "Expected an E.164 phone number");

export const whatsappNumberBodySchema = z.object({ phoneNumber: phoneNumberSchema });
