import { UnauthorizedError, TooManyRequestsError } from "#core/errors/http-errors";

export class InvalidCredentialsError extends UnauthorizedError {
  constructor() {
    // Identical for unknown users and wrong passwords: no account enumeration.
    super("Invalid credentials", "INVALID_CREDENTIALS");
  }
}

export class RefreshTokenInvalidError extends UnauthorizedError {
  constructor() {
    super("Refresh token is missing, malformed, or expired", "REFRESH_TOKEN_INVALID");
  }
}

export class RefreshTokenReusedError extends UnauthorizedError {
  constructor() {
    super(
      "Refresh token was already used; the session has been revoked",
      "REFRESH_TOKEN_REUSED",
    );
  }
}

export class LoginRateLimitedError extends TooManyRequestsError {
  constructor() {
    super("Too many login attempts, try again later", "LOGIN_RATE_LIMITED");
  }
}
