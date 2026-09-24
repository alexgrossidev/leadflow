import { Request, Response } from "express";
import { created, noContent } from "#core/http/response";
import { getTenant, idParam } from "#core/http/request-context";
import { AutomationService } from "./automation.service.js";
import { automationBodySchema, pauseBodySchema } from "./automation.schema.js";

export class AutomationController {
  constructor(private readonly service: AutomationService) {}

  create = async (req: Request, res: Response) => {
    const payload = automationBodySchema.parse(req.body);
    const id = await this.service.create(getTenant(req), payload);
    return created(res, { id });
  };

  update = async (req: Request, res: Response) => {
    const payload = automationBodySchema.parse(req.body);
    await this.service.update(getTenant(req), idParam(req, "automationId"), payload);
    return noContent(res);
  };

  setPaused = async (req: Request, res: Response) => {
    const { paused } = pauseBodySchema.parse(req.body);
    await this.service.setPaused(getTenant(req), idParam(req, "automationId"), paused);
    return noContent(res);
  };

  delete = async (req: Request, res: Response) => {
    await this.service.delete(getTenant(req), idParam(req, "automationId"));
    return noContent(res);
  };
}
