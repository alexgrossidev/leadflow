import { isAxiosError } from "axios";

/**
 * A gateway failure, stripped to what is safe to log.
 *
 * An AxiosError carries the entire exchange on `config`/`response` (including
 * the request body, which for this service is the customer's message, and the
 * service token header). Any logger that walks an error object would write both
 * to disk. This keeps the diagnosable parts (route, status, code), drops the
 * bodies, and keeps the original as `cause`, non-enumerable, so serializers
 * skip it while a debugger can still reach it.
 */
export class LeadflowError extends Error {
  constructor(
    message: string,
    readonly status: number | undefined,
    cause: unknown,
  ) {
    super(message);
    this.name = "LeadflowError";
    Object.defineProperty(this, "cause", {
      value: cause,
      enumerable: false,
      writable: true,
      configurable: true,
    });
  }
}

export const toLeadflowError = (error: unknown): unknown => {
  if (!isAxiosError(error)) return error;

  const route = `${error.config?.method?.toUpperCase() ?? "?"} ${error.config?.url ?? "?"}`;
  const status = error.response?.status;
  const reason = status ?? error.code ?? "no response";

  return new LeadflowError(`Gateway ${route} failed: ${reason}`, status, error);
};
