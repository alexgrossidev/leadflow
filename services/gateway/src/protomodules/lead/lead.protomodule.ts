import { LeadStreamRepository } from "./lead.repo.js";
import { LeadStreamingService } from "./lead.service.js";

export const leadGRPCProvider = new LeadStreamingService(new LeadStreamRepository());
