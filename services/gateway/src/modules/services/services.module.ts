import { BusinessServiceRepository } from "./services.repo.js";
import { BusinessServiceController } from "./services.controller.js";

export const businessServiceController = new BusinessServiceController(
  new BusinessServiceRepository(),
);
