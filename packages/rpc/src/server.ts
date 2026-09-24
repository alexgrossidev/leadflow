import { Server, ServerCredentials } from "@grpc/grpc-js";
import type { GRPCRegisterableService } from "./types.js";
import { withGlobalMiddleware } from "./core/error.interceptors.js";

/**
 * Registers the services and binds the endpoint. Resolves only once the port is
 * bound, so callers can fail startup instead of logging "running" prematurely.
 *
 * Transport is plaintext: the server is meant to be reachable only on the
 * internal network (see docker-compose). Terminate TLS/mTLS at the mesh in prod.
 */
export async function startGrpcServer(
  services: GRPCRegisterableService[],
  endpoint: string,
): Promise<{ server: Server; port: number }> {
  const server = new Server();
  for (const { definition, implementation } of services) {
    server.addService(definition, withGlobalMiddleware(implementation));
  }
  const port = await new Promise<number>((resolve, reject) =>
    server.bindAsync(endpoint, ServerCredentials.createInsecure(), (err, boundPort) =>
      err ? reject(err) : resolve(boundPort),
    ),
  );
  return { server, port };
}
