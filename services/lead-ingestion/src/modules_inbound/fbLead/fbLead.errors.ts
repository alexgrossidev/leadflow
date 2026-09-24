/** Transient lead-capture failure — safe to retry (FB 5xx/timeout, eventual consistency). */
export class LeadRetryableError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "LeadRetryableError";
  }
}

/** Permanent lead-capture failure — retrying will not help (missing token, bad data). */
export class LeadFatalError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "LeadFatalError";
  }
}
