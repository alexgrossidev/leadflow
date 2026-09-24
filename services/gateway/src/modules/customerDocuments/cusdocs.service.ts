import { FileStorage } from "@leadflow/shared/storage";
import { DbExecutor, mainDb } from "#database/mainPool";
import { NotFoundError } from "#core/errors/http-errors";
import { Tenant } from "#core/http/request-context";
import { createUploadRequest, resolveTenantKey } from "#core/filestorage";
import { CustomerRepository } from "../customers/customers.repo.js";
import { CustomerDocumentsRepository, DocumentScope } from "./cusdocs.repo.js";
import { CreateDocumentBody, UpdateDocumentBody } from "./cusdocs.schema.js";

export class CustomerDocumentService {
  constructor(
    private readonly repo: CustomerDocumentsRepository,
    private readonly customers: CustomerRepository,
  ) {}

  async requestUpload(tenant: Tenant, customerId: number, filename: string, contentType: string) {
    await this.assertCustomer(customerId, tenant.businessId);
    return createUploadRequest(
      tenant.userId,
      tenant.businessId,
      filename,
      contentType,
      "CUSTOMER_DOCUMENT",
    );
  }

  async create(tenant: Tenant, customerId: number, input: CreateDocumentBody) {
    // Only keys inside this business's prefix may be attached; otherwise a
    // tenant could register (and later download) another tenant's object.
    const filePath = resolveTenantKey(input.filePath, "CUSTOMER_DOCUMENT", tenant.businessId);

    return mainDb.transaction(async (tx) => {
      await this.assertCustomer(customerId, tenant.businessId, tx);
      const id = await this.repo.create(
        { ...input, filePath, businessId: tenant.businessId, customerId },
        tx,
      );
      return { id };
    });
  }

  async list(scope: DocumentScope) {
    return this.repo.listForCustomer(scope);
  }

  async update(documentId: number, scope: DocumentScope, updates: UpdateDocumentBody) {
    if (!(await this.repo.update(documentId, scope, updates))) {
      throw new NotFoundError("Document not found");
    }
    return { id: documentId };
  }

  /**
   * Soft delete only. The stored object is kept; purging deleted documents
   * from storage is not implemented yet.
   */
  async remove(documentId: number, scope: DocumentScope): Promise<void> {
    if (!(await this.repo.softDelete(documentId, scope))) {
      throw new NotFoundError("Document not found");
    }
  }

  /** Signs a short-lived download URL for one of the tenant's own documents. */
  async getDownloadUrl(documentId: number, scope: DocumentScope): Promise<string> {
    const filePath = await this.repo.findFilePath(documentId, scope);
    if (!filePath) throw new NotFoundError("Document not found");
    return FileStorage.getInstance().getDownloadUrl(filePath, 300);
  }

  private async assertCustomer(customerId: number, businessId: number, db: DbExecutor = mainDb) {
    if (!(await this.customers.existsInBusiness(customerId, businessId, db))) {
      throw new NotFoundError("Customer not found");
    }
  }
}
