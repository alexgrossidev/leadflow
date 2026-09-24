import { logger as defaultLogger, type Logger } from "#core/logger";
import { isRetryableError } from "#core/retry";
import {
  postLeadToGateway,
  type GatewayLeadRequest,
  type GatewayLeadResponse,
} from "#core/http/gateway.client";
import type { Lead } from "../../modules_inbound/fbLead/lead.schema";
import {
  LeadDeliveryRepository,
  type DeliveryGuard,
} from "../../modules_inbound/fbLead/leadDelivery.repo";
import {
  LeadFatalError,
  LeadRetryableError,
} from "../../modules_inbound/fbLead/fbLead.errors";
import type {
  LeadDeliveryClient,
  LeadDeliveryContext,
} from "./lead.types";

/** A genuine delivery finishes in seconds (5s HTTP timeout); older claims are crash-stale. */
const STALE_CLAIM_MS = 2 * 60 * 1000;

/** Typed Lead properties forwarded to the gateway as custom fields. */
const EXTRA_FIELDS = {
  companyName: "company",
  city: "city",
  postalCode: "postal_code",
  address: "address",
  state: "state",
  country: "country",
  website: "website",
  message: "message",
} as const satisfies Partial<Record<keyof Lead, string>>;

/** A lead that has round-tripped through a JSON column has a string date. */
function toIsoDate(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

/** Map a normalised lead onto the gateway's `POST /internal/leads` body. */
export function toGatewayLead(
  lead: Lead,
  ctx: LeadDeliveryContext,
): GatewayLeadRequest {
  const fields: Record<string, string> = {};
  for (const [prop, name] of Object.entries(EXTRA_FIELDS)) {
    const value = lead[prop as keyof typeof EXTRA_FIELDS];
    if (value) fields[name] = value;
  }
  for (const [label, value] of Object.entries(lead.customFields ?? {})) {
    if (value) fields[label] = value;
  }

  return {
    businessId: ctx.businessId,
    userId: ctx.userId,
    source: ctx.source,
    externalId: lead.leadId,
    fullName: lead.fullName ?? null,
    email: lead.email ?? null,
    phone: lead.phoneNumber ?? null,
    fields,
    createdAt: toIsoDate(lead.createdTime),
  };
}

/**
 * Classify a failed POST: 4xx means the gateway rejected this lead and a retry
 * will get the same answer (fatal, dead-lettered for triage); 5xx, 408, 429 and
 * network failures are transient and retried by the queue.
 */
function classify(err: unknown, leadId: string): Error {
  return isRetryableError(err)
    ? new LeadRetryableError(`Gateway delivery of ${leadId} failed (transient)`, err)
    : new LeadFatalError(`Gateway rejected lead ${leadId}`, err);
}

export interface GatewayDeliveryDeps {
  guard: DeliveryGuard;
  send: (body: GatewayLeadRequest) => Promise<GatewayLeadResponse>;
  logger: Logger;
  now: () => number;
}

/**
 * Delivers a lead to the gateway behind the lead_delivery guard: CLAIM
 * (user, lead) before the POST, mark DELIVERED on success, release on failure.
 *
 * The gateway endpoint is itself idempotent on (business, source, externalId),
 * so the guard is defense in depth rather than the only line against
 * duplicates: it stops concurrent deliveries of the same lead, skips the HTTP
 * call entirely on a redrive of a delivered lead, and keeps working if the
 * target is ever swapped for a non-idempotent one.
 */
export function createGatewayLeadDelivery(
  deps: Partial<GatewayDeliveryDeps> = {},
): LeadDeliveryClient {
  const guard = deps.guard ?? new LeadDeliveryRepository();
  const send = deps.send ?? postLeadToGateway;
  const log = deps.logger ?? defaultLogger;
  const now = deps.now ?? Date.now;

  return {
    async deliver(lead: Lead, ctx: LeadDeliveryContext): Promise<void> {
      const claim = await guard.claim(
        ctx.userId,
        lead.leadId,
        new Date(now() - STALE_CLAIM_MS),
      );

      if (claim === "ALREADY_DELIVERED") {
        log.info(
          { leadId: lead.leadId, businessId: ctx.businessId },
          "[Delivery] lead already delivered, skipping",
        );
        return;
      }

      if (claim === "IN_PROGRESS") {
        // A fresh attempt holds the claim: defer instead of racing it. The retry
        // resolves once that attempt completes or its claim goes stale.
        throw new LeadRetryableError(
          `Delivery already in progress for lead ${lead.leadId}`,
        );
      }

      let response: GatewayLeadResponse;
      try {
        response = await send(toGatewayLead(lead, ctx));
      } catch (err) {
        // The POST failed: release the claim so a retry can re-deliver. If the
        // release itself fails, the claim simply goes stale and is reclaimed.
        await guard.release(ctx.userId, lead.leadId).catch((releaseErr) =>
          log.error(
            { err: releaseErr, leadId: lead.leadId },
            "[Delivery] could not release claim after a failed POST",
          ),
        );
        throw classify(err, lead.leadId);
      }

      // The POST succeeded. Record it best-effort: a failed bookkeeping write
      // must not turn into a retry, so log and leave the claim in place (it
      // blocks a re-send until it goes stale, and the gateway dedupes anyway).
      try {
        await guard.markDelivered(ctx.userId, lead.leadId, response);
      } catch (err) {
        log.error(
          { err, leadId: lead.leadId },
          "[Delivery] lead delivered but the guard could not be marked",
        );
      }

      log.info(
        {
          leadId: lead.leadId,
          businessId: ctx.businessId,
          gatewayLeadId: response?.id,
          created: response?.created,
        },
        "[Delivery] lead delivered to gateway",
      );
    },
  };
}
