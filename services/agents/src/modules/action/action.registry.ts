/**
 * Triggers the gateway can report. Only inbound WhatsApp is implemented: the
 * receptionist has no email tools yet, so accepting an email trigger would
 * answer an email on WhatsApp.
 */
export const ACTION_TYPES = ["WHATSAPP_RECEIVED"] as const;

export type ActionType = (typeof ACTION_TYPES)[number];

/**
 * Lifecycle of one run: accepted (pending), picked up by a worker (running),
 * then exactly one terminal state.
 */
export const ACTION_STATUSES = ["pending", "running", "succeeded", "failed"] as const;

export type ActionStatus = (typeof ACTION_STATUSES)[number];
