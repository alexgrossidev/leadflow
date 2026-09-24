import { mainDb } from "#database/mainPool";
import { and, eq, sql } from "drizzle-orm";
import { Bounds } from "#core/schemas/pagination";
import { customersFailedImports } from "../customers/customer.failedimports.table.js";
import { UploadType } from "./upload.types.js";

/** A single rejected row, normalized so every import type reports the same shape. */
export interface ImportFailureRow {
  id: number;
  reason: string;
  sourceKey: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  fieldSlug: string | null;
  fieldValue: string | null;
  createdAt: Date | null;
}

/**
 * Reads the dead-letter detail for one finished import. The report endpoint
 * dispatches on the session's `type`, so adding lead import support is
 * a matter of implementing this contract and registering it below — no changes
 * to the controller/service flow.
 */
export interface ImportFailureSource {
  count(businessId: number, importJobId: string): Promise<number>;
  list(
    businessId: number,
    importJobId: string,
    bounds: Bounds,
  ): Promise<ImportFailureRow[]>;
}

class CustomerImportFailureSource implements ImportFailureSource {
  async count(businessId: number, importJobId: string): Promise<number> {
    const [row] = await mainDb
      .select({ count: sql<number>`count(*)` })
      .from(customersFailedImports)
      .where(
        and(
          eq(customersFailedImports.businessId, businessId),
          eq(customersFailedImports.importJobId, importJobId),
        ),
      );

    return Number(row?.count ?? 0);
  }

  async list(
    businessId: number,
    importJobId: string,
    { limit, offset }: Bounds,
  ): Promise<ImportFailureRow[]> {
    return mainDb
      .select({
        id: customersFailedImports.id,
        reason: customersFailedImports.failureReason,
        sourceKey: customersFailedImports.importSourceKey,
        name: customersFailedImports.customerName,
        email: customersFailedImports.customerEmail,
        phone: customersFailedImports.customerPhone,
        fieldSlug: customersFailedImports.fieldSlug,
        fieldValue: customersFailedImports.fieldValue,
        createdAt: customersFailedImports.createdAt,
      })
      .from(customersFailedImports)
      .where(
        and(
          eq(customersFailedImports.businessId, businessId),
          eq(customersFailedImports.importJobId, importJobId),
        ),
      )
      .orderBy(customersFailedImports.id)
      .limit(limit)
      .offset(offset);
  }
}

export type ImportFailureSourceRegistry = Partial<
  Record<UploadType, ImportFailureSource>
>;

/** The only currently-wired import type. Extend as new importers ship. */
export const importFailureSources: ImportFailureSourceRegistry = {
  customer: new CustomerImportFailureSource(),
};
