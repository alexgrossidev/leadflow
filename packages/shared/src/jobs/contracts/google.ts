/** One answer from a Google Form response: the question label + its value(s). */
export interface GoogleLeadAnswer {
  name: string;
  values: string[];
}

/**
 * A Google Form submission pushed by the external registering service, already
 * authenticated at the edge (HMAC) before enqueue. Carries the raw answers so
 * the worker owns normalisation — mirroring the Facebook capture's PARSE→DELIVER,
 * minus the FETCH stage Google doesn't need. `responseId` is the idempotency key.
 */
export interface GoogleLeadProcessPayload {
  userId: number;
  businessId: number;
  formId?: string;
  responseId: string;
  createdTime?: number;
  answers: GoogleLeadAnswer[];
  /** Soft antispam flags raised at the edge; folded into the CRM notes on delivery. */
  flags?: string[];
}
