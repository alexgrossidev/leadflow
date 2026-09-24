import dotenv from "dotenv";
import { loadEnv } from "#config/env";
import { closeDatabase, initDatabase, pingDatabase } from "#core/db";
import { createCustomerClient } from "#core/grpc";
import { logger } from "#core/logger";
import { S3ObjectStore } from "#core/objectStore";
import { registerProcessGuards } from "#core/process-guards";
import { queue } from "#core/queue";
import { ImportStagingRepository } from "./modules/clientstaging/staging.repo.js";
import { ImportStatusRepository } from "./modules/importstatus/status.repo.js";
import { startWorkers } from "./workers/index.js";

dotenv.config({ quiet: true });
registerProcessGuards("fileparser");

/**
 * Boot order matters: nothing consumes jobs until configuration, the database
 * and object storage have all been verified. Any failure exits non-zero so the
 * orchestrator sees a crashed container rather than a worker that accepts jobs
 * it cannot complete.
 */
async function main(): Promise<void> {
  const config = loadEnv();

  initDatabase(config);
  await pingDatabase();

  const objects = new S3ObjectStore(config);
  const storageLatencyMs = await objects.ping();
  logger.info({ storageLatencyMs, bucket: config.S3_BUCKET }, "Object storage reachable");

  const customerClient = createCustomerClient(config.GATEWAY_GRPC_ADDR);

  startWorkers({
    objects,
    staging: new ImportStagingRepository(),
    status: new ImportStatusRepository(),
    customerClient,
    grpcDeadlineMs: config.GRPC_DEADLINE_MS,
    maxSpreadsheetBytes: config.IMPORT_MAX_BYTES,
  });
  logger.info("Fileparser workers started");

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutting down");
    try {
      // Closing the queue closes its workers, letting in-flight jobs finish.
      await queue.close();
      customerClient.close();
      await closeDatabase();
      process.exit(0);
    } catch (error) {
      logger.error({ err: error }, "Error during shutdown");
      process.exit(1);
    }
  };
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
  process.once("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((error: unknown) => {
  logger.fatal({ err: error }, "Fileparser failed to start");
  process.exit(1);
});
