export class InvalidGoogleSignatureError extends Error {
  readonly statusCode = 403;
  constructor(cause?: unknown) {
    super("Invalid X-Leadflow-Signature", { cause });
    this.name = "InvalidGoogleSignatureError";
  }
}
