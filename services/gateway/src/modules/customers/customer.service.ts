import { Transaction, mainDb } from "#database/mainPool";
import { NotFoundError } from "#core/errors/http-errors";
import { Tenant } from "#core/http/request-context";
import { buildCustomerRowHash } from "#config/create-hash";
import { AuditLogRepository } from "../auditing/audit.repo.js";
import { auditAction } from "../auditing/audit.types.js";
import { CustomerRepository } from "./customers.repo.js";
import { CustomerQueryRepository } from "./customer.query.repo.js";
import {
  CreateCustomerBody,
  CustomerSearchQuery,
  UpdateCustomerBody,
} from "./customers.schema.js";
import {
  AuditContext,
  CustomerRecord,
  MutationIdResult,
  PaginatedCustomers,
} from "./customer.types.js";

type CustomFieldInput = CreateCustomerBody["customFields"];

export class CustomerService {
  constructor(
    private readonly repo: CustomerRepository,
    private readonly searchRepo: CustomerQueryRepository,
    private readonly auditRepo: AuditLogRepository,
  ) {}

  async getCustomer(id: number, businessId: number) {
    const customer = await this.repo.getOne(id, businessId);
    if (!customer) throw new NotFoundError("Customer not found");
    return customer;
  }

  async create(tenant: Tenant, payload: CreateCustomerBody): Promise<MutationIdResult> {
    const { name = null, email = null, phone = null } = payload.customer;

    return mainDb.transaction(async (tx) => {
      const id = await this.repo.createCustomer(
        {
          businessId: tenant.businessId,
          userId: tenant.userId,
          name,
          email,
          phone,
          dataHash: buildCustomerRowHash({
            name,
            email,
            phone,
            customFields: payload.customFields,
          }),
        },
        tx,
      );
      const fields = await this.writeCustomFields(tenant, id, payload.customFields, tx);
      return { id, fields };
    });
  }

  async update(
    tenant: Tenant,
    id: number,
    payload: UpdateCustomerBody,
  ): Promise<MutationIdResult> {
    return mainDb.transaction(async (tx) => {
      // Always runs: it also verifies the customer exists in this business
      // (and locks the row) before any custom field is written for it.
      await this.repo.updateCustomerCore(id, tenant.businessId, payload.customer, tx);
      const fields = await this.writeCustomFields(tenant, id, payload.customFields, tx);
      return { id, fields };
    });
  }

  async delete(id: number, businessId: number): Promise<void> {
    await this.repo.softDeleteCustomer(id, businessId);
  }

  async deleteAll(tenant: Tenant, context: AuditContext): Promise<number> {
    return mainDb.transaction(async (tx) => {
      const deleted = await this.repo.softDeleteAllByBusinessId(tenant.businessId, tx);
      await this.auditRepo.create(
        {
          businessId: tenant.businessId,
          userId: tenant.userId,
          action: auditAction.DELETE_CUSTOMERS_BULK,
          ipAddress: context.ipAddress ?? null,
          userAgent: context.userAgent ?? null,
        },
        tx,
      );
      return deleted;
    });
  }

  async search(businessId: number, query: CustomerSearchQuery): Promise<PaginatedCustomers> {
    const { customerIds, totalCount } = await this.searchRepo.findCustomerIds(
      businessId,
      query,
    );

    const customers =
      customerIds.length === 0 ? [] : await this.hydrate(customerIds, businessId);

    return {
      customers,
      metadata: {
        totalCount,
        page: query.page,
        limit: query.limit,
        totalPages: Math.ceil(totalCount / query.limit),
      },
    };
  }

  async getColumns(businessId: number) {
    return this.repo.getColumns(businessId);
  }

  async createColumn(tenant: Tenant, field: string): Promise<number> {
    return this.repo.createColumn(tenant.userId, tenant.businessId, field);
  }

  async updateColumn(tenant: Tenant, id: number, field: string): Promise<void> {
    await this.repo.updateColumn(id, tenant.businessId, tenant.userId, field);
  }

  async deleteColumn(id: number, businessId: number): Promise<void> {
    await this.repo.deleteColumn(id, businessId);
  }

  private async writeCustomFields(
    tenant: Tenant,
    customerId: number,
    customFields: CustomFieldInput,
    tx: Transaction,
  ) {
    const written: { name: string; id: number }[] = [];
    for (const { fieldSlug, value } of customFields) {
      const fieldId = await this.repo.ensureCustomFieldDefinition(
        tenant.businessId,
        tenant.userId,
        fieldSlug,
        tx,
      );
      await this.repo.upsertCustomValue(
        {
          businessId: tenant.businessId,
          userId: tenant.userId,
          customerId,
          customFieldId: fieldId,
          value,
        },
        tx,
      );
      written.push({ name: fieldSlug, id: fieldId });
    }
    return written;
  }

  /** Folds the flat customer x field rows back into one record per customer. */
  private async hydrate(customerIds: number[], businessId: number): Promise<CustomerRecord[]> {
    const rows = await this.repo.hydrateCustomerEavBatch(customerIds, businessId);
    const byId = new Map<number, CustomerRecord>();

    for (const row of rows) {
      let customer = byId.get(row.customerId);
      if (!customer) {
        customer = {
          id: row.customerId,
          businessId: row.customerBusinessId,
          userId: row.customerUserId,
          name: row.customerName,
          email: row.customerEmail,
          phone: row.customerPhone,
          created: row.customerCreated,
          updated: row.customerUpdated,
          fields: [],
        };
        byId.set(row.customerId, customer);
      }
      if (row.fieldName && row.fieldId !== null) {
        customer.fields.push({ id: row.fieldId, name: row.fieldName, value: row.fieldValue });
      }
    }

    // Keep the page order chosen by the search query.
    return customerIds.flatMap((id) => byId.get(id) ?? []);
  }
}
