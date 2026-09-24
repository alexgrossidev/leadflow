import { BaseController } from "#core/apifactory/base.controller";
import type { ActionService } from "./action.service.js";
import {
  actionCreateSchema,
  actionIdParamSchema,
  actionListQuerySchema,
  actionTenantParamsSchema,
} from "./action.schema.js";

export class ActionController extends BaseController<ActionService> {
  /** 202: accepted for background execution; poll GET /actions/:id for the outcome. */
  create = this.catchAsync(async (req, res) => {
    const input = actionCreateSchema.parse(req.body);
    const action = await this.service.record(input);
    res.location(`${req.baseUrl}/${action.id}`);
    return this.accepted(res, { id: action.id, status: action.status }, "Action accepted");
  });

  get = this.catchAsync(async (req, res) => {
    const { id } = actionIdParamSchema.parse(req.params);
    return this.ok(res, await this.service.get(id));
  });

  list = this.catchAsync(async (req, res) => {
    const tenant = actionTenantParamsSchema.parse(req.params);
    const query = actionListQuerySchema.parse(req.query);
    return this.ok(res, await this.service.list(tenant, query));
  });

  remove = this.catchAsync(async (req, res) => {
    const { id } = actionIdParamSchema.parse(req.params);
    await this.service.remove(id);
    return this.ok(res, { id }, "Action deleted");
  });
}
