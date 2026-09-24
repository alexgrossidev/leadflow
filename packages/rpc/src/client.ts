import { credentials, type ChannelCredentials, type Client } from "@grpc/grpc-js";

/** Default per-call deadline; every client call should set one (see `deadline`). */
export const DEFAULT_DEADLINE_MS = 10_000;

/** `new Date(Date.now() + ms)`, for the `deadline` call option. */
export function deadline(ms: number = DEFAULT_DEADLINE_MS): Date {
  return new Date(Date.now() + ms);
}

// T is the generated client constructor type (e.g., LeadServiceClient)
export function createGrpcClient<T extends Client>(
  ClientConstructor: new (address: string, creds: ChannelCredentials) => T,
  address: string,
): T {
  return new ClientConstructor(address, credentials.createInsecure());
}
