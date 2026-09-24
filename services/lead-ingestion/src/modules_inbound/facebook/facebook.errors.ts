export class InvalidFacebookSignatureError extends Error {
  readonly statusCode = 403;
  constructor() {
    super("Invalid X-Hub-Signature-256");
    this.name = "InvalidFacebookSignatureError";
  }
}

export class FacebookVerifyTokenMismatchError extends Error {
  readonly statusCode = 403;
  constructor() {
    super("Verify token mismatch");
    this.name = "FacebookVerifyTokenMismatchError";
  }
}

export class InvalidServiceTokenError extends Error {
  readonly statusCode = 401;
  constructor() {
    super("Invalid service token");
    this.name = "InvalidServiceTokenError";
  }
}
