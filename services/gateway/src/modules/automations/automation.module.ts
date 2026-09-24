import { AutomationRepository } from "./automation.repo.js";
import { AutomationStepRepository } from "./automation.step.repo.js";
import { AutomationService } from "./automation.service.js";
import { AutomationController } from "./automation.controller.js";

export const automationController = new AutomationController(
  new AutomationService(new AutomationRepository(), new AutomationStepRepository()),
);
