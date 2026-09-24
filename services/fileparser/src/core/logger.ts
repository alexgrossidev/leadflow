import { createRequire } from "node:module";
import pino, { type TransportSingleOptions } from "pino";
import { logSerializers } from "@leadflow/shared/logger";

/**
 * pino-pretty is a developer convenience, not a dependency of this service:
 * it is used only in development and only when it happens to be installed.
 * Production always logs newline-delimited JSON.
 */
function prettyTransport(): TransportSingleOptions | undefined {
  if (process.env.NODE_ENV !== "development") return undefined;
  try {
    createRequire(import.meta.url).resolve("pino-pretty");
  } catch {
    return undefined;
  }
  return {
    target: "pino-pretty",
    options: {
      colorize: true,
      translateTime: "HH:MM:ss.l",
      singleLine: true,
    },
  };
}

/**
 * Structured logger for the parser. Import-pipeline logs are bound with
 * correlation context (importJobId, businessId, stage) via `logger.child`, so a
 * single import can be traced end to end across staging and delivery.
 */
export const logger = pino({
  ...logSerializers,
  level: process.env.LOG_LEVEL || "info",
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => ({ level: label.toUpperCase() }),
  },
  transport: prettyTransport(),
});

export type Logger = typeof logger;
