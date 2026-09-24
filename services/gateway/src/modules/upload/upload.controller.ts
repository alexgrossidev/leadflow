import { Request, Response } from "express";
import { created, ok } from "#core/http/response";
import { getTenant } from "#core/http/request-context";
import { CsvLargeUploadService } from "./upload.service.js";
import {
  importReportQuerySchema,
  launchImportBodySchema,
  listImportsQuerySchema,
  requestUploadBodySchema,
} from "./upload.schema.js";

export class CsvLargeUploadController {
  constructor(private readonly service: CsvLargeUploadService) {}

  requestUpload = async (req: Request, res: Response) => {
    const { filename, contentType } = requestUploadBodySchema.parse(req.body);
    return created(res, await this.service.requestUpload(getTenant(req), filename, contentType));
  };

  launch = async (req: Request, res: Response) => {
    const { objPath, customfieldSettings } = launchImportBodySchema.parse(req.body);
    const session = await this.service.launchImport(getTenant(req), objPath, customfieldSettings);
    return created(res, session);
  };

  list = async (req: Request, res: Response) => {
    const { type } = listImportsQuerySchema.parse(req.query);
    return ok(res, await this.service.listImports(getTenant(req).businessId, type));
  };

  report = async (req: Request, res: Response) => {
    const pagination = importReportQuerySchema.parse(req.query);
    const importJobId = String(req.params.importJobId);
    const report = await this.service.getImportReport(
      getTenant(req).businessId,
      importJobId,
      pagination,
    );
    return ok(res, report);
  };
}
