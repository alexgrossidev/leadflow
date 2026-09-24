import { SERVICE_REGISTRY, ServiceName } from "./services/index.js";

export * from "./services/index.js";
export * from "./server.js";
export * from "./types.js";
export * from "./client.js";
export { GrpcError, toServiceError } from "./core/error.interceptors.js";
export type { Client } from "@grpc/grpc-js";
export type { ServerWritableStream } from "@grpc/grpc-js";
export * from "./gen/index.js";

export function registerService(name: ServiceName, implementation: any) {
  return {
    definition: SERVICE_REGISTRY[name],
    implementation,
  };
}
