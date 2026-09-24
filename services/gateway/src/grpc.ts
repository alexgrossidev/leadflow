import { GRPCRegisterableService, registerService } from "@leadflow/rpc";
import { leadGRPCProvider } from "./protomodules/lead/lead.protomodule.js";
import { customerGRPCProvider } from "./protomodules/customer/customer.protomodule.js";

export const grpcServices: GRPCRegisterableService[] = [
  registerService("lead", {
    getLeadWithFilters: leadGRPCProvider.getLeads.bind(leadGRPCProvider),
  }),
  registerService("customer", {
    bulkInsertCustomers: customerGRPCProvider.bulkInsertCustomers.bind(customerGRPCProvider),
  }),
];
