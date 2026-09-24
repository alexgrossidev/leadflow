import { BusinessRepository } from "./business.repo.js";
import { BusinessService } from "./business.service.js";
import { BusinessController } from "./business.controller.js";

export const businessController = new BusinessController(
  new BusinessService(new BusinessRepository()),
);
