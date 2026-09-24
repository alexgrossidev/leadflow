import { eventNames, getEventEmitter, serviceNames } from "@leadflow/shared/eventBus";
import { logger } from "@leadflow/shared";
import { queue } from "./core/queue";
import { grpcLeadClient } from "./core/grpc";
import { automationRepo } from "./modules/automations/automation.module";
import { pauseRepo, targetRepo } from "./modules/automationTargets/target.module";
import { EnrolmentService } from "./modules/enrolment/enrolment.service";
import { LeadBackfill } from "./protomodules/leads/lead.backfill";
import { createAutomationCreatedHandler } from "./dispatchers/automation.CREATE";
import { createAutomationUpdatedHandler } from "./dispatchers/automation.UPDATED";
import { createDeleteHandler } from "./dispatchers/automation.DELETE";
import { createPauseHandler } from "./dispatchers/automation.PAUSE";
import { createLeadCreatedHandler } from "./dispatchers/lead.CREATED";

export function subscribeToEvents(): void {
  const emitter = getEventEmitter();
  const enrolment = new EnrolmentService(targetRepo, queue);
  const service = serviceNames.AUTOMATIONS;

  emitter.subscribe(
    service,
    eventNames.AUTOMATION_CREATED,
    createAutomationCreatedHandler({
      automations: automationRepo,
      backfill: new LeadBackfill(grpcLeadClient, enrolment),
    }),
  );
  emitter.subscribe(
    service,
    eventNames.AUTOMATION_UPDATED,
    createAutomationUpdatedHandler({ automations: automationRepo }),
  );
  emitter.subscribe(
    service,
    eventNames.AUTOMATION_PAUSED,
    createPauseHandler({ store: pauseRepo, queue }),
  );
  emitter.subscribe(
    service,
    eventNames.AUTOMATION_DELETED,
    createDeleteHandler({ store: pauseRepo, queue }),
  );
  emitter.subscribe(
    service,
    eventNames.LEAD_CREATED,
    createLeadCreatedHandler({ automations: automationRepo, enrolment }),
  );
  logger.info({ service }, "Subscribed to automation and lead events");
}
