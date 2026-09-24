/** One answer as delivered by Meta's `field_data` (and mirrored by the Google relay). */
export interface FacebookFieldData {
  name: string;
  values: string[];
}

/** The `{ id, created_time, field_data }` shape both capture channels normalise from. */
export interface FacebookLeadPayload {
  id: string;
  created_time?: string;
  field_data?: FacebookFieldData[];
}

/** A channel-neutral, normalised lead. */
export interface Lead {
  leadId: string;
  createdTime?: Date;
  fullName?: string;
  email?: string;
  phoneNumber?: string;
  city?: string;
  postalCode?: string;
  companyName?: string;
  address?: string;
  state?: string;
  country?: string;
  website?: string;
  message?: string;
  customFields: Record<string, string>;
}

/** Typed Lead properties a form label can map onto. */
export type LeadField = keyof Omit<Lead, "leadId" | "createdTime" | "customFields">;

/**
 * Atlas targets: a Lead property, or one half of a split name. The halves are
 * not Lead properties; the normaliser joins them into `fullName`.
 */
export type AtlasField = LeadField | "firstName" | "lastName";
