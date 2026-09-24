import { LeadController } from "./lead.controller.js";
import { LeadService } from "./lead.service.js";
import { LeadRepository } from "./lead.repo.js";

export const leadRepository = new LeadRepository();
export const leadController = new LeadController(new LeadService(leadRepository));
