import axios from "axios";
import { env } from "#config/env";
import { toExternalHttpError } from "./http.errors";

/**
 * Body of the gateway's `POST /internal/leads` (the intake contract). The
 * gateway is idempotent on (businessId, source, externalId).
 */
export interface GatewayLeadRequest {
  businessId: number;
  userId: number;
  source: "facebook" | "google_forms";
  externalId: string;
  fullName?: string | null;
  email?: string | null;
  phone?: string | null;
  fields?: Record<string, string>;
  createdAt?: string;
}

/** 201 → `created: true`; 200 → the lead already existed (`created: false`). */
export interface GatewayLeadResponse {
  id: number;
  created: boolean;
}

const client = axios.create({
  baseURL: env.GATEWAY_URL.replace(/\/+$/, ""),
  timeout: 5000,
  headers: { "x-service-token": env.SERVICE_TOKEN },
});

// The request body is customer PII and the headers carry the service token, so
// no AxiosError is allowed past this client.
client.interceptors.response.use(
  (response) => response,
  (error: unknown) => Promise.reject(toExternalHttpError("Gateway", error)),
);

/** Create (or find) a lead in the gateway. Throws a redacted ExternalHttpError on failure. */
export async function postLeadToGateway(
  body: GatewayLeadRequest,
): Promise<GatewayLeadResponse> {
  const res = await client.post<GatewayLeadResponse>("/internal/leads", body);
  return res.data;
}
