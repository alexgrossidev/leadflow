import type { Lead } from "../fbLead/lead.schema";

/**
 * Content-heuristic verdict for a normalised lead.
 * - `drop` + `reasons`: unambiguous junk — do not deliver (audit-logged).
 * - `flags`: soft signals: deliver, but tag them on the lead (`spam_flags`).
 */
export interface ScoreResult {
  drop: boolean;
  reasons: string[];
  flags: string[];
}

/** Throwaway inbox domains — a lead reachable only here is treated as uncontactable. */
const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com",
  "guerrillamail.com",
  "10minutemail.com",
  "tempmail.com",
  "temp-mail.org",
  "yopmail.com",
  "trashmail.com",
  "getnada.com",
  "dispostable.com",
  "sharklasers.com",
]);

const EMAIL_RE = /^[^@\s]+@([^@\s]+\.[^@\s]+)$/;
const LINK_RE = /(https?:\/\/|www\.)/gi;
/** A message with this many links is spam, not an enquiry. */
const LINK_HARD_LIMIT = 3;
/** Fewest digits a dialable phone number can have (E.164 national minimum-ish). */
const MIN_PHONE_DIGITS = 7;

/**
 * Score a normalised lead. A lead is deliverable if it has at least one usable
 * contact channel (a valid non-disposable email OR a plausible phone) and its
 * message is not link-stuffed. Ambiguous-but-usable leads pass with soft flags.
 */
export function scoreLead(lead: Lead): ScoreResult {
  const reasons: string[] = [];
  const flags: string[] = [];

  const emailMatch = EMAIL_RE.exec(lead.email?.trim() ?? "");
  const emailValid = emailMatch !== null;
  const domain = emailMatch?.[1]?.toLowerCase();
  const disposable = domain !== undefined && DISPOSABLE_DOMAINS.has(domain);

  const phoneDigits = (lead.phoneNumber ?? "").replace(/\D/g, "");
  const phoneValid = phoneDigits.length >= MIN_PHONE_DIGITS;

  const hasAnyField = Boolean(lead.email || lead.phoneNumber || lead.fullName);
  const contactable = (emailValid && !disposable) || phoneValid;
  if (!contactable) reasons.push(hasAnyField ? "uncontactable" : "no_contact");

  const linkCount = (lead.message?.match(LINK_RE) ?? []).length;
  if (linkCount >= LINK_HARD_LIMIT) reasons.push("link_spam");

  // Soft: usable lead, but worth flagging for the sales rep.
  if (disposable && phoneValid) flags.push("disposable_email");
  if (linkCount > 0 && linkCount < LINK_HARD_LIMIT) flags.push("links_in_message");

  return { drop: reasons.length > 0, reasons, flags };
}
