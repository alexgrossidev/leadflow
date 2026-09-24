import { BaseController } from "#core/apifactory/base.controller";
import type { AgentConfigService } from "./agent-config.service.js";
import {
  agentConfigBodySchema,
  agentTenantParamsSchema,
} from "./agent-config.schema.js";

export class AgentConfigController extends BaseController<AgentConfigService> {
  upsert = this.catchAsync(async (req, res) => {
    const tenant = agentTenantParamsSchema.parse(req.params);
    const body = agentConfigBodySchema.parse(req.body);
    const config = await this.service.upsert(tenant, body);
    return this.ok(res, config, "Agent config saved");
  });

  get = this.catchAsync(async (req, res) => {
    const tenant = agentTenantParamsSchema.parse(req.params);
    const config = await this.service.get(tenant);
    return this.ok(res, config);
  });
}
