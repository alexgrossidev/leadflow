import {
  Metadata,
  status,
  type ServiceError,
  type UntypedHandleCall,
  type UntypedServiceImplementation,
} from "@grpc/grpc-js";
import pino from "pino";

// Drizzle errors embed bound parameters in the message; strip them before logging
// (same rule as @leadflow/shared's errorSerializer — rpc stays dependency-free).
const redactParams = (err: unknown) => {
  if (!(err instanceof Error)) return err;
  const s = pino.stdSerializers.err(err);
  s.message = s.message.replace(/\nparams: [^\n]*/g, "\nparams: [redacted]");
  if (s.stack) s.stack = s.stack.replace(/\nparams: [^\n]*/g, "\nparams: [redacted]");
  return s;
};

const logger = pino({
  name: "rpc",
  level: process.env.LOG_LEVEL ?? "info",
  serializers: { err: redactParams },
});

/**
 * Throw this from a handler to return a specific gRPC status to the client.
 * Anything else is treated as an internal failure: logged in full server-side,
 * returned to the caller as a generic INTERNAL with no internal details.
 */
export class GrpcError extends Error {
  constructor(
    public readonly code: status,
    message: string,
  ) {
    super(message);
    this.name = "GrpcError";
  }
}

const GRPC_STATUS_CODES = new Set<number>(
  Object.values(status).filter((v): v is number => typeof v === "number"),
);

export function toServiceError(error: unknown): ServiceError {
  const isGrpc =
    error instanceof GrpcError ||
    (typeof (error as { code?: unknown })?.code === "number" &&
      GRPC_STATUS_CODES.has((error as { code: number }).code));

  const code = isGrpc ? (error as { code: status }).code : status.INTERNAL;
  const details = isGrpc ? (error as Error).message : "Internal server error";
  return Object.assign(new Error(details), { code, details, metadata: new Metadata() });
}

/** Wraps every handler so thrown errors become well-formed gRPC statuses. */
export function withGlobalMiddleware(
  implementation: UntypedServiceImplementation,
): UntypedServiceImplementation {
  return Object.fromEntries(
    Object.entries(implementation).map(([name, method]) => [
      name,
      (async (call: any, callback?: (err: ServiceError) => void) => {
        try {
          await (method as (...args: unknown[]) => unknown)(call, callback);
        } catch (error) {
          const serviceError = toServiceError(error);
          logger.error({ method: name, code: serviceError.code, err: error }, "gRPC handler failed");
          // Unary calls report through the callback; streams through destroy.
          if (callback) callback(serviceError);
          else call.destroy(serviceError);
        }
      }) as UntypedHandleCall,
    ]),
  );
}
