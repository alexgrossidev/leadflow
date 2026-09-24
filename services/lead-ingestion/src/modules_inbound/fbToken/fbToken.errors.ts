/** Transient token-flow failure (Graph 5xx/throttling, network, DB blip): the queue retries. */
export class FbTokenRetryableError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "FbTokenRetryableError";
  }
}

/**
 * Permanent token-flow failure (consumed code, revoked permission, no
 * advertisable page): retrying cannot help, the user has to reconnect.
 */
export class FbTokenFatalError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "FbTokenFatalError";
  }
}
