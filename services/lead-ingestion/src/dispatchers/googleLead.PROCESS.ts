import type { GoogleLeadProcessPayload } from "@leadflow/shared/jobs";
import { GoogleLeadDispatcher } from "./googleLead/google.dispatcher";

const dispatcher = new GoogleLeadDispatcher();

/** Entry point for the GOOGLE_LEAD_PROCESS job. */
export function GOOGLE_LEAD_CAPTURE_PROCESS(
  payload: GoogleLeadProcessPayload,
): Promise<void> {
  return dispatcher.run(payload);
}
