import { NotFoundError } from "#core/errors/http-errors";
import type { AgentConfigStore } from "./agent-config.repository.js";
import type {
  AgentConfigInput,
  AgentTenantParams,
} from "./agent-config.schema.js";
import type { AgentConfigRecord } from "./agent-config.table.js";

export class AgentConfigService {
  constructor(private readonly repository: AgentConfigStore) {}

  async upsert(
    tenant: AgentTenantParams,
    input: AgentConfigInput,
  ): Promise<AgentConfigRecord> {
    return this.repository.upsert({ ...tenant, ...input });
  }

  async get(tenant: AgentTenantParams): Promise<AgentConfigRecord> {
    const config = await this.repository.findByTenant(
      tenant.businessId,
      tenant.userId,
    );
    if (!config) {
      throw new NotFoundError(
        `No agent config for business ${tenant.businessId}, user ${tenant.userId}`,
      );
    }
    return config;
  }
}
