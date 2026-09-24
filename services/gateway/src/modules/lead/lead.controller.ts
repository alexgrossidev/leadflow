import { Request, Response } from "express";
import { created, noContent } from "#core/http/response";
import { getTenant, idParam } from "#core/http/request-context";
import { LeadService } from "./lead.service.js";
import { createLeadBodySchema, leadIntakeSchema, updateLeadBodySchema } from "./lead.schema.js";

export class LeadController {
  constructor(private readonly service: LeadService) {}

  create = async (req: Request, res: Response) => {
    const body = createLeadBodySchema.parse(req.body);
    return created(res, await this.service.create(getTenant(req), body));
  };

  update = async (req: Request, res: Response) => {
    const body = updateLeadBodySchema.parse(req.body);
    await this.service.update(getTenant(req), idParam(req, "leadId"), body);
    return noContent(res);
  };

  /**
   * Service-to-service contract: the body is exactly `{ id, created }`
   * (201 new, 200 duplicate), not the public `{ success, data }` envelope.
   */
  intake = async (req: Request, res: Response) => {
    const input = leadIntakeSchema.parse(req.body);
    const result = await this.service.ingest(input);
    return res.status(result.created ? 201 : 200).json(result);
  };
}
