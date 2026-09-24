import { CustomerAssignedServicesRepository } from "./assigned.repo.js";
import { CustomerAssignedServicesService } from "./assigned.service.js";
import { CustomerAssignedServicesController } from "./assigned.controller.js";
import { customerRepository } from "../customers/customer.module.js";

export const customerAssignedController = new CustomerAssignedServicesController(
  new CustomerAssignedServicesService(
    new CustomerAssignedServicesRepository(),
    customerRepository,
  ),
);
