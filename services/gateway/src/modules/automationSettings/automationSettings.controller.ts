import { Request, Response } from "express";
import { noContent } from "#core/http/response";
import { getTenant } from "#core/http/request-context";
import { AutomationSettingsService } from "./automationSettings.service.js";
import { automationSettingsBodySchema } from "./automationSettings.schema.js";

export class AutomationSettingsController {
  constructor(private readonly service: AutomationSettingsService) {}

  create = async (req: Request, res: Response) => {
    const payload = automationSettingsBodySchema.parse(req.body);
    const { businessId, userId } = getTenant(req);
    await this.service.create(businessId, userId, payload);
    return noContent(res);
  };

  update = async (req: Request, res: Response) => {
    const payload = automationSettingsBodySchema.parse(req.body);
    const { businessId, userId } = getTenant(req);
    await this.service.update(businessId, userId, payload);
    return noContent(res);
  };

  delete = async (req: Request, res: Response) => {
    const { businessId, userId } = getTenant(req);
    await this.service.delete(businessId, userId);
    return noContent(res);
  };
}
