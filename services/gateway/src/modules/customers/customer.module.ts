import { CustomerRepository } from "./customers.repo.js";
import { CustomerService } from "./customer.service.js";
import { CustomerController } from "./customer.controller.js";
import { AuditLogRepository } from "../auditing/audit.repo.js";
import { CustomerQueryRepository } from "./customer.query.repo.js";

export const customerRepository = new CustomerRepository();

export const customerController = new CustomerController(
  new CustomerService(
    customerRepository,
    new CustomerQueryRepository(),
    new AuditLogRepository(),
  ),
);
