import type { Server as HttpServer } from "http";
import type { Server as GrpcServer } from "@grpc/grpc-js";
import { startGrpcServer } from "@leadflow/rpc";
import { closeRedis, waitForRedis } from "@leadflow/shared/redis";
import { getQueueProvider, type QueueWorker } from "@leadflow/shared/queue";
import { env } from "#config/env";
import { logger } from "#core/logger";
import { bootstrapFileStorage } from "#core/filestorage";
import { mainPool, pingDatabase, startPoolKeepalive, stopPoolKeepalive } from "#database/mainPool";
import { createApp } from "./app.js";
import { grpcServices } from "./grpc.js";
import { startImportResultWorker } from "./workers/importresult.worker.js";

const SHUTDOWN_TIMEOUT_MS = 10_000;

let httpServer: HttpServer | null = null;
let grpcServer: GrpcServer | null = null;
const workers: QueueWorker[] = [];

async function bootstrap(): Promise<void> {
  // Dependencies first: a gateway that cannot reach its database or Redis
  // must not start accepting traffic.
  await pingDatabase();
  logger.info("Database reachable");
  await waitForRedis();
  logger.info("Redis reachable");
  await bootstrapFileStorage();

  const grpc = await startGrpcServer(grpcServices, env.GRPC_LISTEN_ADDR);
  grpcServer = grpc.server;
  logger.info({ port: grpc.port }, "gRPC server listening");

  workers.push(startImportResultWorker());
  startPoolKeepalive();

  const app = createApp();
  await new Promise<void>((resolve, reject) => {
    httpServer = app.listen(env.PORT, "0.0.0.0", (err?: Error) => (err ? reject(err) : resolve()));
  });
  logger.info({ port: env.PORT, env: env.NODE_ENV }, "HTTP server listening");
}

function closeHttp(): Promise<void> {
  const server = httpServer;
  if (!server) return Promise.resolve();
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeIdleConnections();
  });
}

function closeGrpc(): Promise<void> {
  const server = grpcServer;
  if (!server) return Promise.resolve();
  return new Promise((resolve) => {
    // In-flight streams get the shutdown window; after it they are cut.
    const force = setTimeout(() => server.forceShutdown(), SHUTDOWN_TIMEOUT_MS - 1_000);
    server.tryShutdown(() => {
      clearTimeout(force);
      resolve();
    });
  });
}

let shuttingDown = false;

async function shutdown(reason: string, exitCode: number): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ reason }, "Shutting down");

  const hardExit = setTimeout(() => {
    logger.error("Graceful shutdown timed out");
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  hardExit.unref();

  stopPoolKeepalive();

  // Stop taking new work first, then release what that work depended on.
  const steps: [string, () => Promise<unknown>][] = [
    ["http", closeHttp],
    ["grpc", closeGrpc],
    ["workers", () => Promise.all(workers.map((w) => w.close()))],
    ["queues", () => getQueueProvider().close()],
    ["redis", closeRedis],
    ["database", () => mainPool.end()],
  ];

  for (const [name, step] of steps) {
    try {
      await step();
      logger.info({ step: name }, "Closed");
    } catch (err) {
      exitCode = 1;
      logger.error({ err, step: name }, "Error during shutdown");
    }
  }

  process.exit(exitCode);
}

process.on("SIGTERM", () => void shutdown("SIGTERM", 0));
process.on("SIGINT", () => void shutdown("SIGINT", 0));

process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "Uncaught exception");
  void shutdown("uncaughtException", 1);
});

process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "Unhandled promise rejection");
});

bootstrap().catch((err: unknown) => {
  logger.fatal({ err }, "Failed to start gateway");
  void shutdown("bootstrap failure", 1);
});
