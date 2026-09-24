import { logger, type senderAutomSettingsPayload } from "@leadflow/shared";
import { DEFAULT_TIMEZONE, defaultSettings } from "#config/constants";
import { isValidTimeZone } from "#dispatchers/processor/limiter/time.utils";
import type { SettingsRepository } from "./settings.repo";
import type { Settings } from "./settings.table";

export class SettingsService {
  constructor(private readonly repo: Pick<SettingsRepository, "upsert" | "deleteByBusinessId" | "findByBusinessId">) {}

  async upsert(payload: senderAutomSettingsPayload): Promise<void> {
    await this.repo.upsert({ businessId: payload.businessId, ...payload.settings });
  }

  async delete(businessId: number): Promise<void> {
    await this.repo.deleteByBusinessId(businessId);
  }

  /** The business's settings, or the defaults when it has none. */
  async getForBusiness(businessId: number): Promise<Settings> {
    const row = await this.repo.findByBusinessId(businessId);
    if (!row) return { ...defaultSettings, businessId };
    if (!isValidTimeZone(row.timezone)) {
      logger.warn({ businessId }, "Invalid timezone in settings; using the default");
      return { ...row, timezone: DEFAULT_TIMEZONE };
    }
    return row;
  }
}
