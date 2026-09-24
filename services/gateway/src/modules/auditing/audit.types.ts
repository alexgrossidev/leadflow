export const auditAction = {
  DELETE_CUSTOMERS_BULK: "DELETE_CUSTOMERS_BULK",
} as const;

export type AuditAction = (typeof auditAction)[keyof typeof auditAction];
