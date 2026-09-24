import { Request, Response } from "express";
import { created, noContent, ok } from "#core/http/response";
import { getTenant, idParam } from "#core/http/request-context";
import { CustomerNoteService } from "./cusnotes.service.js";
import { createNoteBodySchema, updateNoteBodySchema } from "./cusnotes.schema.js";

export class CustomerNoteController {
  constructor(private readonly service: CustomerNoteService) {}

  list = async (req: Request, res: Response) => {
    const { businessId } = getTenant(req);
    return ok(res, await this.service.list(businessId, idParam(req, "customerId")));
  };

  create = async (req: Request, res: Response) => {
    const body = createNoteBodySchema.parse(req.body);
    const result = await this.service.create(getTenant(req), idParam(req, "customerId"), body);
    return created(res, result);
  };

  update = async (req: Request, res: Response) => {
    const body = updateNoteBodySchema.parse(req.body);
    const { businessId } = getTenant(req);
    const result = await this.service.update(
      businessId,
      idParam(req, "customerId"),
      idParam(req, "noteId"),
      body,
    );
    return ok(res, result);
  };

  delete = async (req: Request, res: Response) => {
    const { businessId } = getTenant(req);
    await this.service.remove(businessId, idParam(req, "customerId"), idParam(req, "noteId"));
    return noContent(res);
  };
}
