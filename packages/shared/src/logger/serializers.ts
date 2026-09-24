import pino from "pino";

/**
 * Drizzle's query errors embed the bound parameters in the message and stack
 * ("Failed query: …\nparams: alice@example.com,+39…"), which would put customer
 * data and tokens into every log line that records a failed query. This keeps
 * the SQL shape (useful for debugging) and drops the values.
 */
const PARAMS = /\nparams: [^\n]*/g;

export function errorSerializer(err: unknown): unknown {
  if (!(err instanceof Error)) return err;
  const serialized = pino.stdSerializers.err(err);
  serialized.message = serialized.message.replace(PARAMS, "\nparams: [redacted]");
  if (serialized.stack) serialized.stack = serialized.stack.replace(PARAMS, "\nparams: [redacted]");
  return serialized;
}

/** Spread into any pino config: `pino({ ...logSerializers, ... })`. */
export const logSerializers = {
  serializers: { err: errorSerializer, error: errorSerializer },
};
