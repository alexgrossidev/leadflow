import pino from "pino";
import { logSerializers } from "@leadflow/shared/logger";

// Read from process.env directly rather than the validated env module, so the
// logger can be imported by anything (including code that runs before env
// validation) without creating an import cycle.
const isDev = process.env.NODE_ENV === "development";

export const logger = pino({
  ...logSerializers,
  level: process.env.LOG_LEVEL || "info",

  base: undefined, // no pid/hostname: the container runtime adds its own

  timestamp: pino.stdTimeFunctions.isoTime,

  formatters: {
    level: (label) => ({
      level: label.toUpperCase(),
    }),
  },

  transport: isDev
    ? {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "HH:MM:ss.l",
          ignore: "pid,hostname",
          singleLine: true,
          messageFormat: "{msg}",
          errorLikeObjectKeys: ["err", "error"],
        },
      }
    : undefined,

  redact: {
    paths: [
      "password",
      "token",
      "accessToken",
      "refreshToken",
      "authorization",
      "headers.authorization",
      'headers["x-service-token"]',
      "cookie",
      "headers.cookie",
    ],
    censor: "[REDACTED]",
  },
});
