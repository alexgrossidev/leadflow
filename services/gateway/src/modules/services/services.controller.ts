import { Request, Response } from "express";
import { ok } from "#core/http/response";
import { getTenant } from "#core/http/request-context";
import { BusinessServiceRepository } from "./services.repo.js";

export class BusinessServiceController {
  constructor(private readonly repo: BusinessServiceRepository) {}

  list = async (req: Request, res: Response) => {
    return ok(res, await this.repo.listForBusiness(getTenant(req).businessId));
  };
}
