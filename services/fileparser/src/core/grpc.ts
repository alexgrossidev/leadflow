import { Metadata } from "@grpc/grpc-js";
import {
  createGrpcClient,
  CustomerServiceClient,
  deadline,
  type BulkInsertCustomersRequest,
  type BulkInsertCustomersResponse,
} from "@leadflow/rpc";

export function createCustomerClient(address: string): CustomerServiceClient {
  return createGrpcClient<CustomerServiceClient>(CustomerServiceClient, address);
}

/**
 * Promise wrapper around the unary call. Every call carries a deadline, so a
 * gateway that accepts the connection but never answers cannot stall an
 * import forever; the resulting DEADLINE_EXCEEDED is not retried.
 */
export function bulkInsertCustomers(
  client: CustomerServiceClient,
  request: BulkInsertCustomersRequest,
  timeoutMs: number,
): Promise<BulkInsertCustomersResponse> {
  return new Promise((resolve, reject) => {
    client.bulkInsertCustomers(
      request,
      new Metadata(),
      { deadline: deadline(timeoutMs) },
      (error, response) => (error ? reject(error) : resolve(response)),
    );
  });
}
