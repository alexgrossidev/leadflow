import type {
  FacebookLeadPayload,
  Lead,
} from "../../modules_inbound/fbLead/lead.schema";
import { FIELD_ALIAS_MAP } from "./normalise.atlas";
import { joinValues, normalizeKey } from "./normalise.utils";

/**
 * Normalise a `{ id, created_time, field_data }` payload into a clean Lead:
 * known labels map to typed properties via the atlas, everything else is
 * preserved under customFields. Shared by the Facebook and Google capture
 * flows, which deliver the same field_data shape.
 *
 * Names arrive either whole ("Full name") or split ("First name" + "Last
 * name", "Nome" + "Cognome"). A whole name wins; otherwise the parts are
 * joined in first-last order, whatever order the form listed them in.
 */
export function parseFieldDataLead(payload: FacebookLeadPayload): Lead {
  const lead: Lead = {
    leadId: payload.id,
    createdTime: payload.created_time
      ? new Date(payload.created_time)
      : new Date(),
    customFields: {},
  };

  if (!Array.isArray(payload.field_data)) {
    return lead;
  }

  let firstName: string | undefined;
  let lastName: string | undefined;

  for (const field of payload.field_data) {
    if (
      !field.name ||
      !Array.isArray(field.values) ||
      field.values.length === 0
    ) {
      continue;
    }

    const value = joinValues(field.values);
    if (!value) continue;

    const target = FIELD_ALIAS_MAP[normalizeKey(field.name)];
    if (target === "firstName") firstName = value;
    else if (target === "lastName") lastName = value;
    // Known field: typed property (a repeated label keeps the last value).
    else if (target) lead[target] = value;
    // Unknown field: preserved under its original label.
    else lead.customFields[field.name] = value;
  }

  if (!lead.fullName) {
    const joined = [firstName, lastName].filter(Boolean).join(" ");
    if (joined) lead.fullName = joined;
  }

  return lead;
}
