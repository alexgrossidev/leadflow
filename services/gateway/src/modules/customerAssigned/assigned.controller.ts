import { Request, Response } from "express";
import { noContent, ok } from "#core/http/response";
import { getTenant, idParam } from "#core/http/request-context";
import { CustomerAssignedServicesService } from "./assigned.service.js";
import { assignServiceBodySchema, replaceServicesBodySchema } from "./assigned.schema.js";

export class CustomerAssignedServicesController {
  constructor(private readonly service: CustomerAssignedServicesService) {}

  list = async (req: Request, res: Response) => {
    const { businessId } = getTenant(req);
    return ok(res, await this.service.list(businessId, idParam(req, "customerId")));
  };

  assign = async (req: Request, res: Response) => {
    const { serviceId } = assignServiceBodySchema.parse(req.body);
    await this.service.assign(getTenant(req).businessId, idParam(req, "customerId"), serviceId);
    return noContent(res);
  };

  replace = async (req: Request, res: Response) => {
    const { serviceIds } = replaceServicesBodySchema.parse(req.body);
    await this.service.replace(getTenant(req).businessId, idParam(req, "customerId"), serviceIds);
    return noContent(res);
  };

  unassign = async (req: Request, res: Response) => {
    await this.service.unassign(
      getTenant(req).businessId,
      idParam(req, "customerId"),
      idParam(req, "serviceId"),
    );
    return noContent(res);
  };
}
