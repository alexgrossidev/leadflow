import { UnauthorizedError } from "#core/errors/http-errors";

// Distinct codes let the frontend refresh only on expiry and bail otherwise.

export class AccessTokenMissingError extends UnauthorizedError {
  constructor() {
    super("Missing or malformed Authorization header", "TOKEN_MISSING");
  }
}

export class AccessTokenExpiredError extends UnauthorizedError {
  constructor() {
    super("Access token has expired", "TOKEN_EXPIRED");
  }
}

export class AccessTokenInvalidError extends UnauthorizedError {
  constructor() {
    super("Access token is invalid", "TOKEN_INVALID");
  }
}
