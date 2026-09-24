import { Request, Response, NextFunction } from "express";
import { createHash, timingSafeEqual } from "crypto";
import { env } from "#config/env";
import { UnauthorizedError } from "#core/errors/http-errors";

const digest = (value: string) => createHash("sha256").update(value).digest();
const expected = digest(env.SERVICE_TOKEN);

/**
 * Authenticates service-to-service calls (`x-service-token`). Both sides are
 * hashed first so the comparison is constant-time regardless of input length.
 */
export function requireServiceToken(req: Request, _res: Response, next: NextFunction): void {
  const presented = req.get("x-service-token");
  if (!presented || !timingSafeEqual(digest(presented), expected)) {
    return next(new UnauthorizedError("Invalid service token", "SERVICE_TOKEN_INVALID"));
  }
  next();
}
