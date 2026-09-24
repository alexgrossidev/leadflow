export interface CleanupPayload {
  id: number; // automation id
  executionType: CleanerStatusCode; //Type of cleanup, e.g. "pause", "skip", etc...
}

export const CLEANER_CODES = {
  FAST_CLEANUP: "FAST_CLEANUP",
  BULK_CLEANUP: "BULK_CLEANUP",
  DELETE: "DELETE",
} as const;

export type CleanerStatusCode =
  (typeof CLEANER_CODES)[keyof typeof CLEANER_CODES];
