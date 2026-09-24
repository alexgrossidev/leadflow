import { promises as dns } from "node:dns";
import { closeRedis, logger } from "@leadflow/shared";
import { JobNames } from "@leadflow/shared/jobs";
import { getEnv } from "#config/env";

async function main(): Promise<void> {
  const env = getEnv(); // fail fast on missing configuration, before any connection is opened

  // Imported after validation: these modules open the DB pool.
  const { pool } = await import("#core/db");
  const { queue } = await import("#core/queue");
  const { createSmtpTransport } = await import("#core/email.transport");
  const { busWhatsappPublisher } = await import("#core/whatsapp.publisher");
  const { createEmailInspector } = await import("#dispatchers/inspector/email/inspector");
  const { settingsService } = await import("#modules/settings/settings.module");
  const { openingTimesRepo } = await import("#modules/openingTimes/openingTimes.module");
  const { multiseatRepo } = await import("#modules/multiseat/multiseat.module");
  const { usageRepo } = await import("#modules/usage/usage.module");
  const { deliveryRepo } = await import("#modules/deliveries/deliveries.module");
  const { sendingErrorRepo } = await import("#modules/sendingErrors/sendingErrors.module");
  const { createSenderPipeline } = await import("#workers/sender.pipeline");
  const { subscribeToEvents } = await import("./listener");

  const smtp = createSmtpTransport(env);
  const pipeline = createSenderPipeline({
    queue,
    settings: settingsService,
    openingTimes: openingTimesRepo,
    multiseat: multiseatRepo,
    usage: usageRepo,
    deliveries: deliveryRepo,
    errors: sendingErrorRepo,
    email: smtp,
    whatsapp: busWhatsappPublisher,
    inspector: createEmailInspector(env.EMAIL_CHECKS, dns),
  });

  queue.process(JobNames.AUTOMATION_EXECUTE_EXTERNAL, pipeline.handleRequest, { concurrency: 5 });
  // One stage at a time: pacing reads the last send and DELIVER writes it, so
  // running stages concurrently would let several messages share one slot.
  queue.process(JobNames.SENDER_PROCESS, pipeline.handleStage, { concurrency: 1 });
  subscribeToEvents();
  logger.info({ emailChecks: env.EMAIL_CHECKS }, "Sender service started");

  const shutdown = async (signal: string) => {
    logger.info({ signal }, "Shutting down");
    const { getEventEmitter } = await import("@leadflow/shared/eventBus");
    await getEventEmitter().close();
    await queue.close();
    smtp.close();
    await pool.end();
    await closeRedis();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err: unknown) => {
  logger.fatal({ err }, "Sender service failed to start");
  process.exit(1);
});
