import { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { logger } from "#core/logger";
import { AppError } from "#core/errors/app-error";

/** Express reports malformed JSON bodies with a SyntaxError carrying status 400. */
function isBodyParseError(err: unknown): err is SyntaxError & { status: number } {
  return err instanceof SyntaxError && (err as { status?: number }).status === 400;
}

export const globalErrorHandler = (
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
) => {
  const context = { path: req.path, method: req.method };

  if (err instanceof ZodError) {
    logger.debug({ ...context, issues: err.issues.length }, "Request validation failed");
    return res.status(400).json({
      success: false,
      code: "VALIDATION_ERROR",
      message: "The request payload contains validation errors.",
      errors: err.issues.map((issue) => ({
        field: issue.path.join(".") || "payload",
        message: issue.message,
        code: issue.code,
      })),
    });
  }

  if (isBodyParseError(err)) {
    return res.status(400).json({
      success: false,
      code: "MALFORMED_JSON",
      message: "Request body is not valid JSON.",
    });
  }

  if (err instanceof AppError) {
    const level = err.statusCode >= 500 ? "error" : "warn";
    logger[level]({ ...context, code: err.code, err }, "Request failed");
    return res.status(err.statusCode).json({
      success: false,
      code: err.code,
      message: err.message,
    });
  }

  // Anything else is a bug or an infrastructure failure: log everything,
  // return nothing that could leak SQL, stack traces or other tenants' data.
  logger.error({ ...context, err }, "Unhandled request error");
  return res.status(500).json({
    success: false,
    code: "INTERNAL_SERVER_ERROR",
    message: "An unexpected error occurred.",
  });
};
