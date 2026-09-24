import { CustomerImportService } from "./customer.service.js";
import { customerRepository } from "../../modules/customers/customer.module.js";
import { uploadRepository } from "../../modules/upload/upload.module.js";

export const customerGRPCProvider = new CustomerImportService(customerRepository, uploadRepository);
