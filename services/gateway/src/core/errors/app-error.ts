/**
 * Base class for expected, operational failures. The global error handler
 * returns `statusCode` and `code` to the client verbatim, so messages must be
 * safe to show: no SQL, no other tenants' data, no internals.
 */
export abstract class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;

  constructor(message: string, statusCode: number, code: string) {
    super(message);
    this.name = new.target.name;
    this.statusCode = statusCode;
    this.code = code;

    Error.captureStackTrace(this, this.constructor);
  }
}
