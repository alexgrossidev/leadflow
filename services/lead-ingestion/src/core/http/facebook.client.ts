import axios, { type AxiosRequestConfig } from "axios";
import { env } from "#config/env";
import { logger } from "#core/logger";
import { toExternalHttpError } from "./http.errors";

const client = axios.create({
  baseURL: `${env.FB_GRAPH_BASE_URL.replace(/\/+$/, "")}/${env.FB_API_VERSION}`,
  timeout: 5000,
});

client.interceptors.request.use((config) => {
  // Log the path and param names only; the values include access tokens.
  logger.debug(
    { url: config.url, params: Object.keys(config.params ?? {}) },
    "[Graph] request",
  );
  return config;
});

// Redact at the boundary: nothing above this line ever sees an AxiosError.
client.interceptors.response.use(
  (response) => response,
  (error: unknown) => Promise.reject(toExternalHttpError("Graph", error)),
);

export const facebookClient = {
  get: <T>(url: string, config?: AxiosRequestConfig): Promise<T> =>
    client.get<T>(url, config).then((r) => r.data),
  post: <T>(
    url: string,
    data?: unknown,
    config?: AxiosRequestConfig,
  ): Promise<T> => client.post<T>(url, data, config).then((r) => r.data),
};
