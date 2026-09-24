import type { FacebookLeadProcessPayload } from "@leadflow/shared/jobs";
import { LeadCaptureDispatcher } from "./lead/lead.dispatcher";

const dispatcher = new LeadCaptureDispatcher();

/** Entry point for the FACEBOOK_LEAD_PROCESS job. */
export function LEAD_CAPTURE_PROCESS(
  payload: FacebookLeadProcessPayload,
): Promise<void> {
  return dispatcher.run(payload);
}
