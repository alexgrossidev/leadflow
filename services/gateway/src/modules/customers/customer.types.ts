export interface EavStagingRecord {
  /** Identifies the source row, e.g. `<importJobId>_row_<n>`. */
  importSourceKey: string;
  name: string;
  email: string | null;
  phone: string | null;
  /** Custom field slug, e.g. "loyalty_tier"; empty for a customer without custom fields. */
  fieldSlug: string;
  fieldValue: string;
  hash: string;
}

export interface CustomerFieldValue {
  id: number;
  name: string;
  value: string | null;
}

export interface CustomerRecord {
  id: number;
  businessId: number;
  userId: number;
  name: string | null;
  email: string | null;
  phone: string | null;
  created: Date;
  updated: Date;
  fields: CustomerFieldValue[];
}

export interface PaginatedCustomers {
  customers: CustomerRecord[];
  metadata: {
    totalCount: number;
    page: number;
    limit: number;
    totalPages: number;
  };
}

export interface MutationIdResult {
  id: number;
  fields: { name: string; id: number }[];
}

export interface AuditContext {
  ipAddress?: string;
  userAgent?: string;
}
