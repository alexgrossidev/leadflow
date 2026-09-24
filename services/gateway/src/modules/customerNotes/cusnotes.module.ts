import { CustomerNoteRepository } from "./cusnotes.repo.js";
import { CustomerNoteService } from "./cusnotes.service.js";
import { CustomerNoteController } from "./cusnotes.controller.js";
import { customerRepository } from "../customers/customer.module.js";

export const notesController = new CustomerNoteController(
  new CustomerNoteService(new CustomerNoteRepository(), customerRepository),
);
