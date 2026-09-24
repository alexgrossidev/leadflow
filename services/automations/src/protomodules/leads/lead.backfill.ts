import { deadline, type GetLeadWithFiltersRequest, type Lead, type LeadServiceClient } from "@leadflow/rpc";
import { logger } from "@leadflow/shared";
import { BACKFILL_DEADLINE_MS, BATCH_SIZE } from "../../config/constants";
import type { AutomationRow } from "../../modules/automations/automation.table";
import type { EnrolmentCandidate, EnrolmentService } from "../../modules/enrolment/enrolment.service";

type LeadStreamClient = Pick<LeadServiceClient, "getLeadWithFilters">;

function toCandidate(lead: Lead): EnrolmentCandidate | null {
  const id = Number(lead.id);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return { originalId: id, email: lead.email || null, phone: lead.phone || null };
}

/**
 * Enrols the leads that already match a newly created automation. The gateway
 * streams them; `for await` only pulls the next message once the current batch
 * is persisted, so backpressure reaches the server and memory stays bounded.
 */
export class LeadBackfill {
  constructor(
    private readonly client: LeadStreamClient,
    private readonly enrolment: Pick<EnrolmentService, "enrol">,
  ) {}

  async run(automation: AutomationRow): Promise<number> {
    const request: GetLeadWithFiltersRequest = {
      userId: automation.user_id,
      businessId: automation.business_id,
      type: automation.field ? "field" : "all",
      fieldName: automation.field ?? "",
      fieldOperator: automation.operator ?? "",
      fieldValue: automation.value ?? "",
    };
    const stream = this.client.getLeadWithFilters(request, {
      deadline: deadline(BACKFILL_DEADLINE_MS),
    });

    let enrolled = 0;
    let batch: EnrolmentCandidate[] = [];
    const flush = async () => {
      if (batch.length === 0) return;
      enrolled += await this.enrolment.enrol(batch.map((contact) => ({ automation, contact })));
      batch = [];
    };

    try {
      for await (const lead of stream as AsyncIterable<Lead>) {
        const candidate = toCandidate(lead);
        if (candidate) batch.push(candidate);
        if (batch.length >= BATCH_SIZE) await flush();
      }
      await flush();
    } catch (err) {
      stream.cancel();
      throw err;
    }

    logger.info({ automationId: automation.id, enrolled }, "Automation backfill finished");
    return enrolled;
  }
}
