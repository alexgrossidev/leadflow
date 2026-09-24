import { env } from "#config/env";
import { logger } from "#core/logger";
import { queue } from "#core/queue";
import { closeRedis, waitForRedis } from "@leadflow/shared/redis";
import type { FastifyInstance } from "fastify";
import { buildApp } from "./app";
import { databaseKeepAlive } from "./database/keepalive";
import { closePool } from "./database/pool";
import { startWorkers, type RunningWorkers } from "./workers";

/** Hard ceiling on shutdown so a stuck job cannot keep a terminating pod alive. */
const SHUTDOWN_TIMEOUT_MS = 25_000;

function registerGracefulShutdown(app: FastifyInstance, workers: RunningWorkers) {
  let closing = false;

  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    logger.info({ signal }, "Shutting down");

    const forceExit = setTimeout(() => {
      logger.error("Shutdown timed out; forcing exit");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();

    let exitCode = 0;
    try {
      // Order matters: stop intake first, then let in-flight jobs finish, and
      // only then close the connections those jobs use.
      await app.close();
      await workers.stop();
      await queue.close();
      await databaseKeepAlive.stop();
      await closeRedis();
      await closePool();
    } catch (err) {
      exitCode = 1;
      logger.error({ err }, "Error during shutdown");
    } finally {
      process.exit(exitCode);
    }
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

async function main(): Promise<void> {
  const app = await buildApp();
  await waitForRedis();

  const workers = startWorkers();
  databaseKeepAlive.start();
  databaseKeepAlive.on("unhealthy", () =>
    logger.error("Database keep-alive reports the database unhealthy"),
  );
  registerGracefulShutdown(app, workers);

  await app.listen({ port: env.PORT, host: "0.0.0.0" });
  logger.info({ port: env.PORT }, "lead-ingestion listening");
}

main().catch((err) => {
  logger.fatal({ err }, "lead-ingestion failed to start");
  process.exit(1);
});
