import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { logger } from "#core/logger";
import { AppError } from "#core/errors/app-error";

/**
 * Errors thrown by Express's own middleware (body-parser: malformed JSON,
 * payload too large) carry an HTTP status and are safe to expose.
 */
interface HttpLikeError extends Error {
  status: number;
  expose?: boolean;
  type?: string;
}

const isHttpLikeError = (err: unknown): err is HttpLikeError =>
  err instanceof Error &&
  typeof (err as Partial<HttpLikeError>).status === "number" &&
  (err as HttpLikeError).status >= 400 &&
  (err as HttpLikeError).status < 500;

export const createErrorHandler =
  (options: { exposeInternalErrors: boolean }) =>
  (err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
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

    if (err instanceof AppError) {
      if (err.statusCode >= 500) {
        logger.error({ err, path: req.path, method: req.method }, "Request failed");
      }
      return res.status(err.statusCode).json({
        success: false,
        code: err.title,
        message: err.message,
      });
    }

    if (isHttpLikeError(err)) {
      return res.status(err.status).json({
        success: false,
        code: err.type ?? "BAD_REQUEST",
        message: err.expose === false ? "Bad request" : err.message,
      });
    }

    logger.error({ err, path: req.path, method: req.method }, "Unhandled request error");
    return res.status(500).json({
      success: false,
      code: "INTERNAL_SERVER_ERROR",
      message:
        options.exposeInternalErrors && err instanceof Error
          ? err.message
          : "An unexpected error occurred.",
    });
  };
