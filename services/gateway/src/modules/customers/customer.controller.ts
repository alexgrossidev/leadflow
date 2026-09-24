import { Request, Response } from "express";
import { created, noContent, ok } from "#core/http/response";
import { getTenant, idParam } from "#core/http/request-context";
import { BadRequestError } from "#core/errors/http-errors";
import { CustomerService } from "./customer.service.js";
import {
  createCustomerBodySchema,
  customFieldBodySchema,
  customerSearchQuerySchema,
  updateCustomerBodySchema,
} from "./customers.schema.js";

/** `eavFilters` arrives as a JSON-encoded query-string parameter. */
function parseEavFilters(raw: unknown): unknown {
  if (raw === undefined || raw === "") return [];
  if (typeof raw !== "string") throw new BadRequestError("eavFilters must be a JSON array");
  try {
    return JSON.parse(raw);
  } catch {
    throw new BadRequestError("eavFilters must be a JSON array");
  }
}

export class CustomerController {
  constructor(private readonly service: CustomerService) {}

  search = async (req: Request, res: Response) => {
    const { businessId } = getTenant(req);
    const query = customerSearchQuerySchema.parse({
      ...req.query,
      eavFilters: parseEavFilters(req.query.eavFilters),
    });
    return ok(res, await this.service.search(businessId, query));
  };

  get = async (req: Request, res: Response) => {
    const { businessId } = getTenant(req);
    return ok(res, await this.service.getCustomer(idParam(req, "customerId"), businessId));
  };

  create = async (req: Request, res: Response) => {
    const payload = createCustomerBodySchema.parse(req.body);
    return created(res, await this.service.create(getTenant(req), payload));
  };

  update = async (req: Request, res: Response) => {
    const payload = updateCustomerBodySchema.parse(req.body);
    const result = await this.service.update(getTenant(req), idParam(req, "customerId"), payload);
    return ok(res, result);
  };

  delete = async (req: Request, res: Response) => {
    const { businessId } = getTenant(req);
    await this.service.delete(idParam(req, "customerId"), businessId);
    return noContent(res);
  };

  deleteAll = async (req: Request, res: Response) => {
    const deleted = await this.service.deleteAll(getTenant(req), {
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
    });
    return ok(res, { deleted });
  };

  listFields = async (req: Request, res: Response) => {
    return ok(res, await this.service.getColumns(getTenant(req).businessId));
  };

  createField = async (req: Request, res: Response) => {
    const { field } = customFieldBodySchema.parse(req.body);
    const id = await this.service.createColumn(getTenant(req), field);
    return created(res, { id });
  };

  updateField = async (req: Request, res: Response) => {
    const { field } = customFieldBodySchema.parse(req.body);
    await this.service.updateColumn(getTenant(req), idParam(req, "fieldId"), field);
    return noContent(res);
  };

  deleteField = async (req: Request, res: Response) => {
    await this.service.deleteColumn(idParam(req, "fieldId"), getTenant(req).businessId);
    return noContent(res);
  };
}
