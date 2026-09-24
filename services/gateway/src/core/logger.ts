import pino from "pino";
import { logSerializers } from "@leadflow/shared/logger";

const isDevelopment = process.env.NODE_ENV === "development";

export const logger = pino({
  ...logSerializers,
  level: process.env.LOG_LEVEL || "info",

  base: undefined, // drop pid + hostname; the container runtime already adds them

  timestamp: pino.stdTimeFunctions.isoTime,

  formatters: {
    level: (label) => ({
      level: label.toUpperCase(),
    }),
  },

  transport: isDevelopment
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

  // Last line of defence: callers must not log secrets in the first place.
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
