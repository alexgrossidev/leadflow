import { env } from "#config/env";
import { pingDatabase, pool } from "#core/db";
import { eventEmitter } from "#core/eventEmitter";
import { queue } from "#core/queue";
import { messageLogs } from "#modules/messageLogs/messageLog.service";
import { SessionController } from "#modules/sessions/session.controller";
import { sessionService } from "#modules/sessions/session.service";
import { whatsappClient } from "#transport/whatsapp.client";
import { closeRedis, getClient, JobNames, logger, waitForRedis } from "@leadflow/shared";
import { subscribeToEvents } from "./listener";
import { buildServer } from "./server";
import { startTransportHealthMonitor } from "./workers/whatsapp.health";
import { createWhatsappJobProcessor } from "./workers/whatsapp.process";

async function boot() {
  await pingDatabase();
  await waitForRedis();

  subscribeToEvents();

  queue.process(
    JobNames.WHATSAPP_PROCESS,
    createWhatsappJobProcessor({
      messageLogs,
      client: whatsappClient,
      onSent: (businessId, userId) => sessionService.recordActivity(businessId, userId),
      maxAttempts: env.WHATSAPP_QUEUE_ATTEMPTS,
    }),
    { concurrency: env.WHATSAPP_WORKER_CONCURRENCY },
  );

  const stopHealthMonitor = startTransportHealthMonitor(whatsappClient, env.WHATSAPP_SESSION_HEALTH_INTERVAL_MS);

  const app = await buildServer({
    controller: new SessionController(sessionService, whatsappClient),
    serviceToken: env.SERVICE_TOKEN,
    webhookSecret: env.WA_WEBHOOK_SECRET,
    healthChecks: {
      database: pingDatabase,
      redis: () => getClient().ping(),
      transport: () => whatsappClient.healthCheck(),
    },
  });
  await app.listen({ port: env.PORT, host: env.HOST });
  logger.info({ port: env.PORT }, "Whatsapp service listening");

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "Whatsapp service shutting down");
    stopHealthMonitor();
    try {
      await app.close();
      await eventEmitter.close();
      await queue.close();
      await closeRedis();
      await pool.end();
    } catch (err) {
      logger.error({ err }, "Error during shutdown");
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

boot().catch((err: unknown) => {
  logger.error({ err }, "Whatsapp service failed to start");
  process.exit(1);
});
