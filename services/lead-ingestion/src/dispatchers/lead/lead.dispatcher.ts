import { logger as defaultLogger, type Logger } from "#core/logger";
import { isRetryableError } from "#core/retry";
import type { FacebookLeadProcessPayload } from "@leadflow/shared/jobs";

import { FacebookLeadRepository } from "../../modules_inbound/fbLead/fbLead.repo";
import { FacebookTokenRepository } from "../../modules_inbound/fbToken/fbToken.repo";
import { getLeadDetailsAPI } from "../../modules_inbound/fbLead/fbLead.api";
import type {
  FacebookLeadPayload,
  Lead,
} from "../../modules_inbound/fbLead/lead.schema";
import {
  LeadFatalError,
  LeadRetryableError,
} from "../../modules_inbound/fbLead/fbLead.errors";

import { parseFieldDataLead } from "./normalise";
import { createGatewayLeadDelivery } from "./lead.delivery";
import type { LeadCaptureApi, LeadDeliveryClient } from "./lead.types";
import {
  asJsonObject,
  isParsed,
  needsDelivery,
  needsFetch,
  type LeadRow,
} from "./lead.logic";

/** Persistence the dispatcher needs; narrowed so tests can pass an in-memory fake. */
export type LeadStore = Pick<FacebookLeadRepository, "getByLeadId" | "upsert">;
export type PageTokenLookup = Pick<FacebookTokenRepository, "findByFbPageId">;

export interface LeadCaptureDeps {
  leadRepo: LeadStore;
  tokenRepo: PageTokenLookup;
  api: LeadCaptureApi;
  delivery: LeadDeliveryClient;
  logger: Logger;
}

const defaultApi: LeadCaptureApi = {
  getLeadDetails: getLeadDetailsAPI,
};

/**
 * Captures one Facebook lead as a resumable, idempotent state machine:
 * FETCH → PARSE → DELIVER, each guarded by the persisted `facebook_lead` row so
 * a retry resumes from the last completed stage and never replays a side effect.
 * Every collaborator is injected (defaulting to the real one) so each stage can
 * be exercised in isolation.
 */
export class LeadCaptureDispatcher {
  private readonly leadRepo: LeadStore;
  private readonly tokenRepo: PageTokenLookup;
  private readonly api: LeadCaptureApi;
  private readonly delivery: LeadDeliveryClient;
  private readonly log: Logger;

  constructor(deps: Partial<LeadCaptureDeps> = {}) {
    this.leadRepo = deps.leadRepo ?? new FacebookLeadRepository();
    this.tokenRepo = deps.tokenRepo ?? new FacebookTokenRepository();
    this.api = deps.api ?? defaultApi;
    this.delivery = deps.delivery ?? createGatewayLeadDelivery();
    this.log = deps.logger ?? defaultLogger;
  }

  async run(input: FacebookLeadProcessPayload): Promise<void> {
    const { userId, businessId, token } = await this.runStep("resolve", () =>
      this.resolveAccount(input.pageId),
    );
    let row: LeadRow = await this.runStep("load", () =>
      this.leadRepo.getByLeadId(userId, input.leadgenId),
    );
    row = await this.runStep("fetch", () =>
      this.fetch(input, userId, token, row),
    );
    row = await this.runStep("parse", () => this.parse(input, userId, row));
    await this.runStep("deliver", () => this.deliver(userId, businessId, row));
  }

  /** Resolve the owning user, business and page token from the webhook's page id. */
  private async resolveAccount(
    pageId: string,
  ): Promise<{ userId: number; businessId: number; token: string }> {
    const tokenRow = await this.tokenRepo.findByFbPageId(pageId);
    if (!tokenRow?.token) {
      throw new LeadFatalError(`No stored token for page ${pageId}`);
    }
    if (tokenRow.tokenType !== "page") {
      // A reconnect is mid-flight: the row briefly holds a user token. Wait
      // for the exchange to finish rather than calling Graph with it.
      throw new LeadRetryableError(
        `Token for page ${pageId} is being re-exchanged`,
      );
    }
    return {
      userId: tokenRow.userId,
      businessId: tokenRow.businessId,
      token: tokenRow.token,
    };
  }

  /** STAGE 1: fetch the full lead from Facebook and persist the raw response. */
  async fetch(
    input: FacebookLeadProcessPayload,
    userId: number,
    token: string,
    row: LeadRow,
  ): Promise<LeadRow> {
    if (!needsFetch(row)) return row;

    const raw = await this.api.getLeadDetails(input.leadgenId, token);
    const rawObject = asJsonObject(raw);
    if (!rawObject || !Array.isArray(rawObject.field_data)) {
      // Graph is eventually consistent: a brand-new lead may not be readable yet.
      throw new LeadRetryableError(
        `Empty lead response for ${input.leadgenId}`,
      );
    }

    await this.leadRepo.upsert({
      userId,
      leadId: input.leadgenId,
      fetched: true,
      delivered: row?.delivered ?? false,
      rawResponse: rawObject,
      cleanResponse: asJsonObject(row?.cleanResponse) ?? {},
    });

    return this.leadRepo.getByLeadId(userId, input.leadgenId);
  }

  /** STAGE 2: normalise the raw response into a clean lead via the atlas parser. */
  async parse(
    input: FacebookLeadProcessPayload,
    userId: number,
    row: LeadRow,
  ): Promise<LeadRow> {
    if (!row || isParsed(row)) return row;

    const raw = asJsonObject(row.rawResponse);
    if (!raw) {
      throw new LeadFatalError(
        `Unparseable raw response for ${input.leadgenId}`,
      );
    }
    const lead = parseFieldDataLead(raw as unknown as FacebookLeadPayload);
    lead.leadId = input.leadgenId;

    await this.leadRepo.upsert({
      userId,
      leadId: input.leadgenId,
      fetched: true,
      delivered: row.delivered,
      rawResponse: raw,
      cleanResponse: lead,
    });

    return this.leadRepo.getByLeadId(userId, input.leadgenId);
  }

  /** STAGE 3: hand the clean lead to the delivery sink, then mark it delivered. */
  async deliver(
    userId: number,
    businessId: number,
    row: LeadRow,
  ): Promise<void> {
    if (!row || !needsDelivery(row)) return;

    const lead = asJsonObject(row.cleanResponse) as unknown as Lead | null;
    if (!lead) {
      throw new LeadFatalError(`Missing parsed lead for ${row.leadId}`);
    }

    await this.delivery.deliver(lead, { userId, businessId, source: "facebook" });

    await this.leadRepo.upsert({
      userId,
      leadId: row.leadId,
      fetched: true,
      delivered: true,
      rawResponse: asJsonObject(row.rawResponse) ?? row.rawResponse,
      cleanResponse: lead,
    });
  }

  /**
   * Wrap a stage so failures are logged with their stage and normalised into a
   * classified, cause-preserving error: domain failures pass through, transient
   * faults become retryable (the worker resumes), anything else fails fast.
   */
  private async runStep<T>(stage: string, op: () => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch (err) {
      this.log.error({ stage, err }, `Lead capture step '${stage}' failed`);
      if (err instanceof LeadRetryableError || err instanceof LeadFatalError) {
        throw err;
      }
      throw isRetryableError(err)
        ? new LeadRetryableError(`${stage} failed (transient)`, err)
        : new LeadFatalError(`${stage} failed`, err);
    }
  }
}
