import { Request, Response } from "express";
import { created, noContent, ok } from "#core/http/response";
import { getTenant, idParam } from "#core/http/request-context";
import { CustomerDocumentService } from "./cusdocs.service.js";
import {
  createDocumentBodySchema,
  requestUploadBodySchema,
  updateDocumentBodySchema,
} from "./cusdocs.schema.js";
import { DocumentScope } from "./cusdocs.repo.js";

const scopeOf = (req: Request): DocumentScope => ({
  businessId: getTenant(req).businessId,
  customerId: idParam(req, "customerId"),
});

export class CustomerDocumentsController {
  constructor(private readonly service: CustomerDocumentService) {}

  requestUpload = async (req: Request, res: Response) => {
    const { filename, contentType } = requestUploadBodySchema.parse(req.body);
    const upload = await this.service.requestUpload(
      getTenant(req),
      idParam(req, "customerId"),
      filename,
      contentType,
    );
    return created(res, upload);
  };

  create = async (req: Request, res: Response) => {
    const body = createDocumentBodySchema.parse(req.body);
    return created(res, await this.service.create(getTenant(req), idParam(req, "customerId"), body));
  };

  list = async (req: Request, res: Response) => {
    return ok(res, await this.service.list(scopeOf(req)));
  };

  update = async (req: Request, res: Response) => {
    const body = updateDocumentBodySchema.parse(req.body);
    return ok(res, await this.service.update(idParam(req, "documentId"), scopeOf(req), body));
  };

  delete = async (req: Request, res: Response) => {
    await this.service.remove(idParam(req, "documentId"), scopeOf(req));
    return noContent(res);
  };

  download = async (req: Request, res: Response) => {
    const url = await this.service.getDownloadUrl(idParam(req, "documentId"), scopeOf(req));
    return ok(res, { url });
  };
}
