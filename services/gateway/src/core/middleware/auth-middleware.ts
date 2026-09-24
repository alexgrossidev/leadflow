import { Request, Response, NextFunction } from "express";
import { z } from "zod";
import { extractBearerToken, verifyAccessToken } from "#core/auth/tokens";
import { AccessTokenMissingError } from "#core/auth/auth.errors";
import { ForbiddenError } from "#core/errors/http-errors";
import { BusinessContextService } from "#comms/redis/business.cache";

/** The global auth wall: every route mounted after it requires a valid access token. */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const token = extractBearerToken(req.headers.authorization);
  if (!token) return next(new AccessTokenMissingError());

  try {
    req.auth = verifyAccessToken(token);
    next();
  } catch (err) {
    next(err);
  }
}

const businessIdParam = z.coerce.number().int().positive();

/**
 * Guards every `/businesses/:businessId/...` route. Fails closed: a malformed
 * id, a missing auth context or a business the user does not own is a 403,
 * never a pass-through.
 */
export async function requireBusinessAccess(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const auth = req.auth;
  const parsed = businessIdParam.safeParse(req.params.businessId);
  if (!auth || !parsed.success) {
    return next(new ForbiddenError("Access denied", "BUSINESS_ACCESS_DENIED"));
  }

  try {
    const businessIds = await BusinessContextService.getBusinessIds(auth.userId);
    if (!businessIds.includes(parsed.data)) {
      return next(new ForbiddenError("Access denied", "BUSINESS_ACCESS_DENIED"));
    }
    req.tenant = { userId: auth.userId, businessId: parsed.data };
    next();
  } catch (err) {
    next(err);
  }
}
