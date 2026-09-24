import { status, type sendUnaryData, type ServerUnaryCall } from "@grpc/grpc-js";
import {
  GrpcError,
  type BulkInsertCustomersRequest,
  type BulkInsertCustomersResponse,
  type Customer,
} from "@leadflow/rpc";
import { logger } from "#core/logger";
import { CustomerRepository } from "../../modules/customers/customers.repo.js";
import { CsvLargeUploadRepository } from "../../modules/upload/upload.repo.js";
import type { EavStagingRecord } from "../../modules/customers/customer.types.js";

/**
 * Flattens one batch of imported customers into EAV staging rows: one row per
 * non-empty custom field, or a single placeholder row (empty slug) when a
 * customer has none, so the identity (name/email/phone) is still upserted.
 */
export function toStagingRecords(importJobId: string, customers: Customer[]): EavStagingRecord[] {
  const records: EavStagingRecord[] = [];

  customers.forEach((c, index) => {
    const base = {
      importSourceKey: `${importJobId}_row_${index}`,
      name: c.name?.trim() || "Unknown Customer",
      email: c.email?.trim().toLowerCase() || null,
      phone: c.phone?.trim() || null,
      hash: c.hash || "",
    };

    const fields = Object.entries(c.customFields ?? {})
      .map(([slug, value]) => [slug.trim(), String(value ?? "").trim()] as const)
      .filter(([slug, value]) => slug !== "" && value !== "");

    if (fields.length === 0) {
      records.push({ ...base, fieldSlug: "", fieldValue: "" });
      return;
    }
    for (const [fieldSlug, fieldValue] of fields) {
      records.push({ ...base, fieldSlug, fieldValue });
    }
  });

  return records;
}

export class CustomerImportService {
  constructor(
    private readonly customers: CustomerRepository,
    private readonly uploads: CsvLargeUploadRepository,
  ) {}

  /**
   * Receives one parsed batch from the fileparser. The import job must be a
   * session of the same business; its owner is recorded as the rows' author.
   * Failures are thrown: the rpc middleware logs them and returns a generic
   * INTERNAL, so no SQL or row data reaches the caller.
   */
  async bulkInsertCustomers(
    call: ServerUnaryCall<BulkInsertCustomersRequest, BulkInsertCustomersResponse>,
    callback: sendUnaryData<BulkInsertCustomersResponse>,
  ): Promise<void> {
    const { importJobId, businessId } = call.request;
    if (!importJobId || !businessId) {
      throw new GrpcError(status.INVALID_ARGUMENT, "importJobId and businessId are required");
    }

    const session = await this.uploads.findSessionByJobId(importJobId, businessId);
    if (!session) {
      throw new GrpcError(status.NOT_FOUND, "Unknown import job for this business");
    }

    const customers = call.request.customers ?? [];
    if (customers.length > 0) {
      await this.customers.pureSQLCustomerIngestion(
        businessId,
        session.userId,
        importJobId,
        toStagingRecords(importJobId, customers),
      );
    }

    logger.info({ importJobId, businessId, rows: customers.length }, "Customer batch staged");
    callback(null, {
      success: true,
      recordsProcessed: customers.length,
      message: customers.length > 0 ? "Batch staged" : "Empty batch",
    });
  }
}
