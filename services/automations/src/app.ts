import { closeRedis, logger } from "@leadflow/shared";
import { JobNames } from "@leadflow/shared/jobs";
import { getEnv } from "./config/env";

async function main(): Promise<void> {
  getEnv(); // fail fast on missing configuration, before any connection is opened

  // Imported after validation: these modules open the DB pool and gRPC channel.
  const { queue } = await import("./core/queue");
  const { pool } = await import("./core/db");
  const { automationRepo } = await import("./modules/automations/automation.module");
  const { contactRepo, pauseRepo, targetRepo } = await import(
    "./modules/automationTargets/target.module"
  );
  const { createExecutionHandler } = await import("./workers/automation.process");
  const { createCleanupHandler } = await import("./workers/cleaner.process");
  const { createUnpauseHandler } = await import("./workers/automation.unpause");
  const { subscribeToEvents } = await import("./listener");

  queue.process(
    JobNames.AUTOMATION_EXECUTE_INTERNAL,
    createExecutionHandler({
      automations: automationRepo,
      targets: targetRepo,
      contacts: contactRepo,
      queue,
    }),
    { concurrency: 10 },
  );
  queue.process(JobNames.CLEANUP, createCleanupHandler({ store: pauseRepo }));
  queue.process(JobNames.AUTOMATION_UNPAUSE, createUnpauseHandler({ store: pauseRepo, queue }));
  subscribeToEvents();
  logger.info("Automations service started");

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutting down");
    const { getEventEmitter } = await import("@leadflow/shared/eventBus");
    await getEventEmitter().close();
    await queue.close();
    await pool.end();
    await closeRedis();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err: unknown) => {
  logger.fatal({ err }, "Automations service failed to start");
  process.exit(1);
});
