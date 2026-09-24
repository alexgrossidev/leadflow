import { mainDb } from "#database/mainPool";
import { BadRequestError, NotFoundError } from "#core/errors/http-errors";
import { CustomerRepository } from "../customers/customers.repo.js";
import { CustomerAssignedServicesRepository } from "./assigned.repo.js";

export class CustomerAssignedServicesService {
  constructor(
    private readonly repo: CustomerAssignedServicesRepository,
    private readonly customers: CustomerRepository,
  ) {}

  async list(businessId: number, customerId: number) {
    return this.repo.listActive(businessId, customerId);
  }

  async assign(businessId: number, customerId: number, serviceId: number): Promise<void> {
    await this.replaceOrAdd(businessId, customerId, [serviceId], false);
  }

  /** Makes the customer's assignments exactly `serviceIds` (empty clears them). */
  async replace(businessId: number, customerId: number, serviceIds: number[]): Promise<void> {
    await this.replaceOrAdd(businessId, customerId, serviceIds, true);
  }

  async unassign(businessId: number, customerId: number, serviceId: number): Promise<void> {
    if (!(await this.repo.remove(businessId, customerId, serviceId))) {
      throw new NotFoundError("Assignment not found");
    }
  }

  private async replaceOrAdd(
    businessId: number,
    customerId: number,
    serviceIds: number[],
    replace: boolean,
  ): Promise<void> {
    await mainDb.transaction(async (tx) => {
      // Both ids come from the client: verify each belongs to this business
      // before linking them, otherwise the write would cross tenants.
      if (!(await this.customers.existsInBusiness(customerId, businessId, tx))) {
        throw new NotFoundError("Customer not found");
      }
      if (!(await this.repo.servicesBelongToBusiness(businessId, serviceIds, tx))) {
        throw new BadRequestError("Unknown service id", "UNKNOWN_SERVICE");
      }
      if (replace) await this.repo.removeExcept(businessId, customerId, serviceIds, tx);
      await this.repo.upsert(businessId, customerId, serviceIds, tx);
    });
  }
}
