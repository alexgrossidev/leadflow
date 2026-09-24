/**
 * Drizzle wraps every driver failure in a DrizzleQueryError whose message is
 * `Failed query: <sql>\nparams: <values>`. For this service the params are
 * access tokens and lead PII, and that message would flow into logs and into
 * BullMQ's persisted `failedReason`. It also hides the MySQL error code one
 * level down in `cause`, so checks like `err.code === "ER_DUP_ENTRY"` silently
 * stop matching.
 *
 * Every repository runs its queries through {@link dbOp}, which rethrows a
 * {@link DatabaseError} carrying only the operation label and driver codes.
 */
export class DatabaseError extends Error {
  constructor(
    readonly operation: string,
    readonly code: string | undefined,
    readonly errno: number | undefined,
  ) {
    super(`Database operation '${operation}' failed: ${code ?? "unknown"}`);
    this.name = "DatabaseError";
  }
}

interface DriverErrorShape {
  code?: unknown;
  errno?: unknown;
  cause?: unknown;
}

/** First MySQL/Node error code found on the error or its cause chain. */
export function dbErrorCode(err: unknown): string | undefined {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current; depth++) {
    const code = (current as DriverErrorShape).code;
    if (typeof code === "string") return code;
    current = (current as DriverErrorShape).cause;
  }
  return undefined;
}

function dbErrno(err: unknown): number | undefined {
  let current: unknown = err;
  for (let depth = 0; depth < 5 && current; depth++) {
    const errno = (current as DriverErrorShape).errno;
    if (typeof errno === "number") return errno;
    current = (current as DriverErrorShape).cause;
  }
  return undefined;
}

export function toDatabaseError(operation: string, err: unknown): DatabaseError {
  if (err instanceof DatabaseError) return err;
  return new DatabaseError(operation, dbErrorCode(err), dbErrno(err));
}

/** Run a query and rethrow any failure as a redacted {@link DatabaseError}. */
export async function dbOp<T>(
  operation: string,
  run: () => Promise<T>,
): Promise<T> {
  try {
    return await run();
  } catch (err) {
    throw toDatabaseError(operation, err);
  }
}

export const isDuplicateKey = (err: unknown): boolean =>
  dbErrorCode(err) === "ER_DUP_ENTRY";
