import { eventNames, type LeadCreatedPayload } from "@leadflow/shared/eventBus";
import { logger } from "#core/logger";
import { isDuplicateKeyError } from "#database/mainPool";
import { Tenant } from "#core/http/request-context";
import {
  NotFoundError,
  ServiceUnavailableError,
  UnprocessableEntityError,
} from "#core/errors/http-errors";
import { emitToAutomations } from "#comms/bullmq/bullmq.eventEmitter";
import { LeadRepository } from "./lead.repo.js";
import { Lead } from "./lead.table.js";
import { CreateLeadBody, LeadIntake, UpdateLeadBody } from "./lead.schema.js";

export interface IntakeResult {
  id: number;
  created: boolean;
}

export type LeadEventEmitter = (
  payload: LeadCreatedPayload,
  jobId: string,
) => Promise<unknown>;

const defaultEmitter: LeadEventEmitter = (payload, jobId) =>
  emitToAutomations(eventNames.LEAD_CREATED, payload, { jobId });

function toLeadCreatedPayload(lead: Lead): LeadCreatedPayload {
  return {
    leadId: lead.id,
    businessId: lead.businessId,
    userId: lead.userId,
    source: lead.source,
    fullName: lead.name,
    email: lead.email,
    phone: lead.phone,
    // Pipeline status travels with the custom fields so automation rules can
    // match on it the same way the gRPC backfill filter does.
    fields: { ...(lead.customFields ?? {}), ...(lead.status ? { status: lead.status } : {}) },
    createdAt: lead.created_at.toISOString(),
  };
}

export class LeadService {
  constructor(
    private readonly repo: LeadRepository,
    private readonly emit: LeadEventEmitter = defaultEmitter,
  ) {}

  /**
   * Idempotent intake from lead-ingestion, keyed on (business, source, externalId).
   *
   * `lead.created` is published after the insert commits and `event_emitted_at`
   * records that it was. If publishing fails the request fails with 503 and the
   * caller retries: the retry finds the existing lead (200, created:false), sees
   * the event still pending and publishes it then. The job id is derived from
   * the lead id, so the queue also deduplicates a double publish.
   */
  async ingest(input: LeadIntake): Promise<IntakeResult> {
    if (!(await this.repo.businessBelongsToUser(input.businessId, input.userId))) {
      throw new UnprocessableEntityError("Unknown business for this user", "UNKNOWN_BUSINESS");
    }

    let lead: Lead | null;
    let created: boolean;
    try {
      const id = await this.repo.insert({
        businessId: input.businessId,
        userId: input.userId,
        source: input.source,
        externalId: input.externalId,
        name: input.fullName ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        customFields: input.fields ?? {},
        ...(input.createdAt ? { created_at: new Date(input.createdAt) } : {}),
      });
      lead = await this.repo.findById(id, input.businessId);
      created = true;
    } catch (err) {
      if (!isDuplicateKeyError(err)) throw err;
      lead = await this.repo.findByExternalId(input.businessId, input.source, input.externalId);
      created = false;
    }

    if (!lead) throw new Error("Lead missing right after insert/lookup");

    if (!lead.eventEmittedAt) {
      await this.publishCreated(lead, true);
    }

    logger.info(
      { leadId: lead.id, businessId: lead.businessId, source: lead.source, created },
      "Lead intake processed",
    );
    return { id: lead.id, created };
  }

  async create(tenant: Tenant, body: CreateLeadBody): Promise<{ id: number }> {
    const { customFields, ...fields } = body;
    const id = await this.repo.insert({
      ...fields,
      customFields: customFields ?? {},
      businessId: tenant.businessId,
      userId: tenant.userId,
      source: "manual",
    });

    const lead = await this.repo.findById(id, tenant.businessId);
    if (lead) await this.publishCreated(lead, false);
    return { id };
  }

  async update(tenant: Tenant, id: number, body: UpdateLeadBody): Promise<void> {
    const { archived, ...fields } = body;
    const updated = await this.repo.update(id, tenant.businessId, {
      ...fields,
      ...(archived !== undefined ? { archived: archived ? 1 : 0 } : {}),
    });
    if (!updated) throw new NotFoundError("Lead not found");
  }

  /**
   * Publishes `lead.created` and records it. With `failRequest`, a publish
   * failure surfaces as 503 so the caller retries; otherwise it is logged and
   * the lead stays flagged as not yet announced.
   */
  private async publishCreated(lead: Lead, failRequest: boolean): Promise<void> {
    try {
      await this.emit(toLeadCreatedPayload(lead), `lead.created:${lead.id}`);
    } catch (err) {
      logger.error({ err, leadId: lead.id }, "Failed to publish lead.created");
      if (failRequest) {
        throw new ServiceUnavailableError(
          "Lead stored but not yet announced; retry the request",
          "LEAD_EVENT_PENDING",
        );
      }
      return;
    }
    await this.repo.markEventEmitted(lead.id);
  }
}
