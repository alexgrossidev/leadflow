import { CleanupPayload } from "./cleanup";

export interface AutomationExecuteInternalPayload {
  automationId: number;
  userId: number;
  leadId: number;
  type: "customer" | "lead";
  executionType: "launch" | "pause";
}

export interface AutomationExecuteExternalPayload {
  automationId: number;
  userId: number;
  businessId: number;
  recipientData: {
    id: number;
    type: "customer" | "lead";
    email?: string;
    phone?: string;
    assignedToUserId?: number; //This is needed for multiseat configurations to determine which user's limits to check against.
  };
  content: {
    content?: string;
    subject?: string;
    type: "email" | "whatsapp";
  };
}

export interface AutomationUnpausePayload extends CleanupPayload {
  lastId: number; //The id of the last execution, used to determine from which point to resume.
  userId: number;
}
