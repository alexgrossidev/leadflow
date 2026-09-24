import { logger } from "#core/logger";

/**
 * Last-resort safety net against silent process death. The import pipeline now
 * propagates errors through BullMQ, but these handlers guarantee that anything
 * that still escapes is surfaced loudly rather than vanishing:
 *  - unhandledRejection: logged at error level (process kept alive).
 *  - uncaughtException: logged at fatal level, then exit so the orchestrator
 *    restarts a clean instance instead of running in a corrupted state.
 */
export function registerProcessGuards(context: string): void {
  process.on("unhandledRejection", (reason) => {
    logger.error(
      { err: reason, context },
      "[UNHANDLED REJECTION] A promise rejected without a handler",
    );
  });

  process.on("uncaughtException", (error) => {
    logger.fatal(
      { err: error, context },
      "[UNCAUGHT EXCEPTION] Fatal error; exiting",
    );
    process.exit(1);
  });
}
