import type { Server } from "node:http";
import { agentConfig } from "#config/agent";
import { env } from "#config/env";
import { onboardingConfig } from "#config/onboarding";
import { AgentLoop } from "#core/agent/loop";
import { createLlmProvider } from "#core/agent/providers/index";
import { createLeadflowClient } from "#core/axios/leadflow.client";
import { logger } from "#core/logger";
import { WorkQueue } from "#core/queue/work-queue";
import { DISPATCH_AGENT_ACTION } from "#dispatchers/agent";
import { ONBOARD } from "#dispatchers/onboarding";
import { HttpWebsiteEnricher, NoopWebsiteEnricher } from "#dispatchers/onboarding/enrich";
import { ActionExecutor } from "#modules/action/action.executor";
import { DrizzleActionStore } from "#modules/action/action.repository";
import { ActionService } from "#modules/action/action.service";
import { DrizzleAgentConfigStore } from "#modules/agent-config/agent-config.repository";
import { AgentConfigService } from "#modules/agent-config/agent-config.service";
import { HealthService } from "#modules/health/health.service";
import { DrizzleIdempotencyStore } from "#modules/onboarding/onboarding.repository";
import { OnboardingService } from "#modules/onboarding/onboarding.service";
import { createApp } from "./app.js";
import { createDatabase } from "./database/pool.js";

/** Composition root: the only place concrete implementations are chosen. */
const database = createDatabase(env);
const client = createLeadflowClient({ baseUrl: env.GATEWAY_URL, serviceToken: env.SERVICE_TOKEN });

const receptionistLoop = new AgentLoop(createLlmProvider(env), agentConfig.llm);
const onboardingLoop = new AgentLoop(
  createLlmProvider(env, { effort: onboardingConfig.llm.effort }),
  onboardingConfig.llm,
);

const actionStore = new DrizzleActionStore(database.db);
const configStore = new DrizzleAgentConfigStore(database.db);

const executor = new ActionExecutor(
  actionStore,
  configStore,
  (action, config, signal) =>
    DISPATCH_AGENT_ACTION(
      action,
      config,
      { loop: receptionistLoop, client, attachmentUrlPrefixes: env.ATTACHMENT_URL_PREFIXES },
      signal,
    ),
  { runTimeoutMs: agentConfig.llm.runTimeoutMs, retry: agentConfig.retry },
);
const queue = new WorkQueue<string>((id) => executor.execute(id), {
  concurrency: env.AGENT_CONCURRENCY,
  limit: env.AGENT_QUEUE_LIMIT,
});

const enricher = onboardingConfig.enrichment.enabled
  ? new HttpWebsiteEnricher(onboardingConfig.enrichment)
  : new NoopWebsiteEnricher();

const app = createApp({
  serviceToken: env.SERVICE_TOKEN,
  exposeInternalErrors: env.NODE_ENV !== "production",
  actions: new ActionService(actionStore, queue),
  agentConfigs: new AgentConfigService(configStore),
  onboarding: new OnboardingService(new DrizzleIdempotencyStore(database.db), (request) =>
    ONBOARD(request, {
      loop: onboardingLoop,
      enricher,
      client,
      fieldTimeoutMs: onboardingConfig.llm.fieldTimeoutMs,
      enrichmentTimeoutMs: onboardingConfig.enrichment.timeoutMs,
    }),
  ),
  health: new HealthService(database.ping),
});

let server: Server | undefined;

const start = async (): Promise<void> => {
  server = app.listen(env.PORT, "0.0.0.0", () => {
    logger.info(
      { port: env.PORT, env: env.NODE_ENV, llmProvider: env.LLM_PROVIDER },
      "Agents service listening",
    );
  });
  // Runs left over from a previous process: settle or re-queue them.
  await executor.recover((id) => queue.enqueue(id)).catch((error: unknown) => {
    logger.error({ err: error }, "Recovery sweep failed; pending runs wait for the next boot");
  });
};

let shuttingDown = false;
const shutdown = async (signal: string, exitCode = 0): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Graceful shutdown started");

  // Stop accepting requests first, then let in-flight runs finish (each is
  // bounded by its own deadline), then close the pool they write to.
  if (server) {
    const closing = server;
    await new Promise<void>((resolve) =>
      closing.close((error) => {
        if (error) logger.warn({ err: error }, "HTTP server close reported an error");
        resolve();
      }),
    );
  }
  await queue.close();
  await database.close();
  logger.info("Shutdown complete");
  process.exit(exitCode);
};

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("uncaughtException", (err: Error) => {
  logger.fatal({ err }, "Uncaught exception");
  void shutdown("uncaughtException", 1);
});
process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "Unhandled rejection");
});

void start();
