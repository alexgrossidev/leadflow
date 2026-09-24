import type { BulkInsertCustomersRequest } from "@leadflow/rpc";
import type { MappedCustomer } from "./fieldMapping.js";
import { customerHash } from "./hash.js";

/**
 * Packages a batch of already-mapped customers into the gRPC bulk-insert
 * request. Column mapping happened upstream; this layer only fills defaults and
 * stamps each customer with the hash the gateway dedupes on.
 */
export function createCustomerGRPCPayload(
  importJobId: string,
  businessId: number,
  customers: MappedCustomer[],
): BulkInsertCustomersRequest {
  return {
    importJobId,
    businessId,
    customers: customers.map((customer) => ({
      name: customer.name || "Unknown Customer",
      email: customer.email,
      phone: customer.phone,
      customFields: customer.customFields,
      hash: customerHash(customer),
    })),
  };
}
