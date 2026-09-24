import { logger as rootLogger } from "@leadflow/shared/logger";

/**
 * Service logger. Redaction is a safety net, not the primary control: code
 * should log ids and counts, never secrets. These paths catch the credential
 * headers Fastify could attach to a request log, plus token-shaped fields that
 * might slip into a logged object.
 */
export const logger = rootLogger.child(
  { service: "lead-ingestion" },
  {
    redact: {
      paths: [
        "req.headers.authorization",
        'req.headers["x-service-token"]',
        'req.headers["x-hub-signature-256"]',
        'req.headers["x-leadflow-signature"]',
        "*.access_token",
        "*.accessToken",
        "*.client_secret",
        "*.fb_exchange_token",
        "*.refreshToken",
      ],
      censor: "[redacted]",
    },
  },
);

export type Logger = typeof logger;
