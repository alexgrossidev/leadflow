import { mainDb } from "#database/mainPool";
import { NotFoundError } from "#core/errors/http-errors";
import { Tenant } from "#core/http/request-context";
import { CustomerRepository } from "../customers/customers.repo.js";
import { CustomerNoteRepository } from "./cusnotes.repo.js";
import { CreateNoteBody, UpdateNoteBody } from "./cusnotes.schema.js";
import { CustomerNote } from "./cusnotes.table.js";

export class CustomerNoteService {
  constructor(
    private readonly repo: CustomerNoteRepository,
    private readonly customers: CustomerRepository,
  ) {}

  async list(businessId: number, customerId: number): Promise<CustomerNote[]> {
    return this.repo.listForCustomer({ businessId, customerId });
  }

  async create(tenant: Tenant, customerId: number, input: CreateNoteBody): Promise<{ id: number }> {
    return mainDb.transaction(async (tx) => {
      // The customer id comes from the URL; make sure it belongs to this tenant
      // before attaching anything to it.
      if (!(await this.customers.existsInBusiness(customerId, tenant.businessId, tx))) {
        throw new NotFoundError("Customer not found");
      }
      const now = new Date();
      const id = await this.repo.insert(
        {
          ...input,
          customerId,
          businessId: tenant.businessId,
          createdBy: tenant.userId,
          createdAt: now,
          updatedAt: now,
        },
        tx,
      );
      return { id };
    });
  }

  async update(
    businessId: number,
    customerId: number,
    noteId: number,
    updates: UpdateNoteBody,
  ): Promise<{ id: number }> {
    const updated = await this.repo.update(noteId, { businessId, customerId }, updates);
    if (!updated) throw new NotFoundError("Note not found");
    return { id: noteId };
  }

  async remove(businessId: number, customerId: number, noteId: number): Promise<void> {
    const deleted = await this.repo.softDelete(noteId, { businessId, customerId });
    if (!deleted) throw new NotFoundError("Note not found");
  }
}
