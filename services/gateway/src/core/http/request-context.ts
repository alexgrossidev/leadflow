import { Request } from "express";
import { z } from "zod";
import { AuthenticatedUser } from "#core/auth/auth.types";
import { BadRequestError } from "#core/errors/http-errors";

/** The tenant a business-scoped request acts on, verified by the business guard. */
export interface Tenant {
  userId: number;
  businessId: number;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthenticatedUser;
      tenant?: Tenant;
    }
  }
}

/**
 * Tenant ids come only from here: the verified token plus the guarded
 * `:businessId` URL segment. Handlers never read them from the request body.
 */
export function getTenant(req: Request): Tenant {
  if (!req.tenant) {
    // A route was mounted outside the business guard: a wiring bug, not a client error.
    throw new Error("Tenant context missing: route is not behind the business guard");
  }
  return req.tenant;
}

export function getAuth(req: Request): AuthenticatedUser {
  if (!req.auth) {
    throw new Error("Auth context missing: route is not behind authenticate()");
  }
  return req.auth;
}

const positiveId = z.coerce.number().int().positive();

/** Parses a numeric id from the URL, answering 400 instead of querying with NaN. */
export function idParam(req: Request, name: string): number {
  const parsed = positiveId.safeParse(req.params[name]);
  if (!parsed.success) {
    throw new BadRequestError(`Invalid ${name}`, "INVALID_PARAM");
  }
  return parsed.data;
}
