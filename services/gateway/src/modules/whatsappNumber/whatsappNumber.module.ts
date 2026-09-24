import { WhatsappNumberRepository } from "./whatsappNumber.repo.js";
import { WhatsappNumberService } from "./whatsappNumber.service.js";
import { WhatsappNumberController } from "./whatsappNumber.controller.js";

export const whatsappNumberController = new WhatsappNumberController(
  new WhatsappNumberService(new WhatsappNumberRepository()),
);
