import { timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { UnauthorizedError } from "#core/errors/http-errors";

/**
 * Internal service-to-service auth: callers (the gateway) must present the
 * shared secret in the `x-service-token` header, compared in constant time.
 */
export const createServiceAuth = (expectedToken: string): RequestHandler => {
  if (!expectedToken) {
    throw new Error("Service auth misconfigured: expected token is empty");
  }
  const expected = Buffer.from(expectedToken);

  return (req, _res, next) => {
    const provided = req.header("x-service-token");
    if (!provided) {
      return next(new UnauthorizedError("Missing service token"));
    }
    const given = Buffer.from(provided);
    const matches =
      given.length === expected.length && timingSafeEqual(given, expected);
    if (!matches) {
      return next(new UnauthorizedError("Invalid service token"));
    }
    next();
  };
};
