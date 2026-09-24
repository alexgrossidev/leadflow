import axios from "axios";
import { logger } from "#core/logger";
import { toLeadflowError } from "./leadflow.errors.js";

/**
 * The agent's whole outbound surface. The agent never touches a channel itself;
 * the gateway remains the hands, so every WhatsApp send, appointment and
 * onboarding record goes through here and the endpoint contract can change
 * without reaching into the engine or tools.
 *
 * An interface, so dispatchers take it as a dependency and tests pass a fake
 * instead of mocking a module.
 */
export interface LeadflowClient {
  post<T>(path: string, body: unknown, options?: { signal?: AbortSignal }): Promise<T>;
}

export interface LeadflowClientOptions {
  baseUrl: string;
  serviceToken: string;
  timeoutMs?: number;
}

export const createLeadflowClient = (options: LeadflowClientOptions): LeadflowClient => {
  const http = axios.create({
    baseURL: options.baseUrl,
    timeout: options.timeoutMs ?? 10_000,
    headers: {
      "Content-Type": "application/json",
      "x-service-token": options.serviceToken,
    },
  });

  http.interceptors.request.use((config) => {
    // Route only: never params, body or headers.
    logger.debug({ url: config.url }, "Gateway request");
    return config;
  });

  // Sanitize at the boundary: an AxiosError carries the request body (the
  // customer's message) and the service token, and anything that later logs
  // the error would write both. Nothing past this point can leak them.
  http.interceptors.response.use(
    (response) => response,
    (error: unknown) => Promise.reject(toLeadflowError(error)),
  );

  return {
    post: async <T>(path: string, body: unknown, requestOptions?: { signal?: AbortSignal }) =>
      (await http.post<T>(path, body, { signal: requestOptions?.signal })).data,
  };
};
