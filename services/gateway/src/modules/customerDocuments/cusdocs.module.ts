import { CustomerDocumentsRepository } from "./cusdocs.repo.js";
import { CustomerDocumentService } from "./cusdocs.service.js";
import { CustomerDocumentsController } from "./cusdocs.controller.js";
import { customerRepository } from "../customers/customer.module.js";

export const docsController = new CustomerDocumentsController(
  new CustomerDocumentService(new CustomerDocumentsRepository(), customerRepository),
);
