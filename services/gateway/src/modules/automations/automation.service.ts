import { eventNames } from "@leadflow/shared/eventBus";
import { logger } from "#core/logger";
import { mainDb } from "#database/mainPool";
import { NotFoundError } from "#core/errors/http-errors";
import { Tenant } from "#core/http/request-context";
import { emitToAutomations } from "#comms/bullmq/bullmq.eventEmitter";
import { AutomationRepository } from "./automation.repo.js";
import { AutomationStepRepository } from "./automation.step.repo.js";
import { AutomationBody } from "./automation.schema.js";

/**
 * Events are emitted after the transaction commits, so consumers never see a
 * rule that was rolled back. The trade-off: if Redis is unreachable at that
 * moment the change is saved but the event is lost (logged, not retried). A
 * transactional outbox would close that gap; it is not implemented here.
 */
async function publishAfterCommit(
  event: string,
  ids: Record<string, number>,
  emit: () => Promise<unknown>,
): Promise<void> {
  try {
    await emit();
  } catch (err) {
    logger.error({ err, event, ...ids }, "Event emit failed after commit");
  }
}

export class AutomationService {
  constructor(
    private readonly repository: AutomationRepository,
    private readonly stepRepository: AutomationStepRepository,
  ) {}

  async create(tenant: Tenant, payload: AutomationBody): Promise<number> {
    const { steps, ...fields } = payload;

    const automation = await mainDb.transaction(async (tx) => {
      const id = await this.repository.insert(
        { ...fields, user_id: tenant.userId, business_id: tenant.businessId },
        tx,
      );
      const savedSteps = await this.stepRepository.sync(id, steps, tx);
      const row = await this.repository.findForUpdate(id, tenant.businessId, tx);
      return { ...row, id, steps: savedSteps };
    });

    logger.info({ automationId: automation.id, businessId: tenant.businessId }, "Automation created");
    await publishAfterCommit(eventNames.AUTOMATION_CREATED, { automationId: automation.id }, () =>
      emitToAutomations(eventNames.AUTOMATION_CREATED, { userId: tenant.userId, automation }),
    );
    return automation.id;
  }

  async update(tenant: Tenant, id: number, payload: AutomationBody): Promise<void> {
    const { steps, ...fields } = payload;

    const automation = await mainDb.transaction(async (tx) => {
      if (!(await this.repository.findForUpdate(id, tenant.businessId, tx))) {
        throw new NotFoundError("Automation not found");
      }
      await this.repository.update(id, tenant.businessId, fields, tx);
      const savedSteps = await this.stepRepository.sync(id, steps, tx);
      const row = await this.repository.findForUpdate(id, tenant.businessId, tx);
      return { ...row, id, steps: savedSteps };
    });

    await publishAfterCommit(eventNames.AUTOMATION_UPDATED, { automationId: id }, () =>
      emitToAutomations(eventNames.AUTOMATION_UPDATED, { userId: tenant.userId, automation }),
    );
  }

  async setPaused(tenant: Tenant, id: number, paused: boolean): Promise<void> {
    await mainDb.transaction(async (tx) => {
      if (!(await this.repository.findForUpdate(id, tenant.businessId, tx))) {
        throw new NotFoundError("Automation not found");
      }
      await this.repository.update(id, tenant.businessId, { paused }, tx);
    });

    await publishAfterCommit(eventNames.AUTOMATION_PAUSED, { automationId: id }, () =>
      emitToAutomations(eventNames.AUTOMATION_PAUSED, {
        userId: tenant.userId,
        businessId: tenant.businessId,
        automationId: id,
        paused,
      }),
    );
  }

  async delete(tenant: Tenant, id: number): Promise<void> {
    await mainDb.transaction(async (tx) => {
      if (!(await this.repository.findForUpdate(id, tenant.businessId, tx))) {
        throw new NotFoundError("Automation not found");
      }
      await this.stepRepository.deleteAll(id, tx);
      await this.repository.delete(id, tenant.businessId, tx);
    });

    await publishAfterCommit(eventNames.AUTOMATION_DELETED, { automationId: id }, () =>
      emitToAutomations(eventNames.AUTOMATION_DELETED, {
        userId: tenant.userId,
        businessId: tenant.businessId,
        automationId: id,
      }),
    );
  }
}
