import { randomUUID } from "node:crypto";
import { ImportResultReportPayload, JobNames } from "@leadflow/shared/jobs";
import { FileStorage } from "@leadflow/shared/storage";
import { queue } from "#comms/bullmq/bullmq.queue";
import { createUploadRequest, resolveTenantKey } from "#core/filestorage";
import { Tenant } from "#core/http/request-context";
import { getBounds, paginate, PaginationQuery } from "#core/schemas/pagination";
import {
  ImportReportNotSupportedError,
  ImportSessionNotFoundError,
  ObjectNotStoredError,
} from "./upload.errors.js";
import { CsvLargeUploadRepository } from "./upload.repo.js";
import { CustomFieldSettings } from "./upload.schema.js";
import { ImportFailureSourceRegistry } from "./import-failures.source.js";
import { UploadType } from "./upload.types.js";

export class CsvLargeUploadService {
  constructor(
    private readonly repo: CsvLargeUploadRepository,
    private readonly failureSources: ImportFailureSourceRegistry,
  ) {}

  async requestUpload(tenant: Tenant, filename: string, contentType: string) {
    return createUploadRequest(
      tenant.userId,
      tenant.businessId,
      filename,
      contentType,
      "CUSTOMER_BULK_IMPORT",
    );
  }

  async launchImport(tenant: Tenant, objPath: string, settings: CustomFieldSettings) {
    // The key must sit in this business's own prefix: otherwise a tenant could
    // import (and read back through the failure report) another tenant's file.
    const storageKey = resolveTenantKey(objPath, "CUSTOMER_BULK_IMPORT", tenant.businessId);

    // Fail fast here rather than later in a background worker.
    if (!(await FileStorage.getInstance().hasObject(storageKey))) {
      throw new ObjectNotStoredError();
    }

    const importJobId = randomUUID();
    const id = await this.repo.create({
      userId: tenant.userId,
      businessId: tenant.businessId,
      type: "customer",
      storageKey,
      importJobId,
      status: "uploaded",
    });

    // Single enqueue: the parser chains the serialize step once staging is ready.
    await queue.enqueue(JobNames.HEAVY_PROCESSES_IMPORT, {
      id: importJobId,
      userId: tenant.userId,
      businessId: tenant.businessId,
      type: "customer",
      filePath: storageKey,
      customfieldSettings: settings,
    });

    return { id, importJobId };
  }

  async listImports(businessId: number, type: UploadType) {
    const sessions = await this.repo.findLatestByBusiness(businessId, type);
    return sessions.map((session) => ({
      importJobId: session.importJobId,
      status: session.status,
      totalRows: session.totalRows,
      processedRows: session.processedRows,
      failedRows: session.failedRows,
      startedAt: session.started_at,
      completedAt: session.completed_at,
    }));
  }

  /**
   * Paginated view of one import: the session summary plus its dead-letter
   * rows. Failure detail is resolved per session type, so other import types
   * only need to register an ImportFailureSource.
   */
  async getImportReport(businessId: number, importJobId: string, pagination: PaginationQuery) {
    const session = await this.repo.findSessionByJobId(importJobId, businessId);
    if (!session) throw new ImportSessionNotFoundError();

    const source = this.failureSources[session.type];
    if (!source) throw new ImportReportNotSupportedError(session.type);

    const bounds = getBounds(pagination);
    const [totalCount, rows] = await Promise.all([
      source.count(businessId, importJobId),
      source.list(businessId, importJobId, bounds),
    ]);

    return {
      summary: {
        importJobId: session.importJobId,
        type: session.type,
        status: session.status,
        totalRows: session.totalRows,
        processedRows: session.processedRows,
        failedRows: session.failedRows,
        startedAt: session.started_at,
        completedAt: session.completed_at,
      },
      failures: paginate(rows, totalCount, pagination),
    };
  }

  async applyResults(result: ImportResultReportPayload): Promise<void> {
    await this.repo.applyResult(result);
  }
}
