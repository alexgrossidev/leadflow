import { Request, Response } from "express";
import { created, noContent, ok } from "#core/http/response";
import { getAuth, getTenant } from "#core/http/request-context";
import { BusinessService } from "./business.service.js";
import { createBusinessSchema, updateBusinessSchema } from "./business.schema.js";

export class BusinessController {
  constructor(private readonly service: BusinessService) {}

  create = async (req: Request, res: Response) => {
    const payload = createBusinessSchema.parse(req.body);
    const id = await this.service.createBusiness(getAuth(req).userId, payload);
    return created(res, { id });
  };

  list = async (req: Request, res: Response) => {
    return ok(res, await this.service.getBusinessesForUser(getAuth(req).userId));
  };

  get = async (req: Request, res: Response) => {
    const { businessId, userId } = getTenant(req);
    return ok(res, await this.service.getBusiness(businessId, userId));
  };

  update = async (req: Request, res: Response) => {
    const { businessId, userId } = getTenant(req);
    const payload = updateBusinessSchema.parse(req.body);
    return ok(res, await this.service.editBusiness(businessId, userId, payload));
  };

  delete = async (req: Request, res: Response) => {
    const { businessId, userId } = getTenant(req);
    await this.service.deleteBusiness(businessId, userId);
    return noContent(res);
  };
}
