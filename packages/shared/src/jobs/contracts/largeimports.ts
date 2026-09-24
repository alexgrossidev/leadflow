export interface LargeImportPayload {
  id: string; //Generic id, could be used for anything (lead, automation, etc...)
  businessId: number;
  userId: number;
  type: "lead" | "customer";
  filePath: string;
  // Carried through so the parser can chain the serialize step once staging is ready.
  customfieldSettings?: CustomFieldSettings;
}

export interface CompleteImportWithSettingsPayload {
  sessionId: string;
  userId: number;
  businessId: number;
  type: "lead" | "customer";
  customfieldSettings?: CustomFieldSettings;
  leadSettings?: LeadImportSettings;
}

/** Mirrors the upload_session.status enum the user-facing result is surfaced through. */
export type ImportResultStatus = "processing" | "completed" | "failed";

/**
 * Terminal/progress signal emitted by the parser so the gateway can surface the
 * import outcome on its own upload_session row (cross-service, queue-driven).
 */
export interface ImportResultReportPayload {
  importJobId: string;
  businessId: number;
  status: ImportResultStatus;
  totalRows?: number;
  processedRows?: number;
  failedRows?: number;
  /** Developer-facing failure detail; not shown verbatim to the user. */
  error?: string;
}

interface CustomFieldSettings {
  fieldsToDelete: string[];
  merges: {
    fieldName: string;
    target: string;
  }[];

  import: string[];
}

interface LeadImportSettings {
  data: string;
}
