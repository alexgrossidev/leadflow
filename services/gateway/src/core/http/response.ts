import { Response } from "express";

/**
 * The single success envelope used by every public route:
 *   { success: true, data, message? }
 * Errors use { success: false, code, message, errors? } (see error-handler.ts).
 */
export function ok<T>(res: Response, data: T, message?: string): Response {
  return res.status(200).json({ success: true, data, ...(message && { message }) });
}

export function created<T>(res: Response, data: T, message?: string): Response {
  return res.status(201).json({ success: true, data, ...(message && { message }) });
}

/** 204 carries no body by definition. */
export function noContent(res: Response): Response {
  return res.status(204).end();
}
