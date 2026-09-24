import { describe, expect, it } from "vitest";
import { defaultSettings } from "#config/constants";
import { SettingsService } from "../settings.service";
import type { Settings } from "../settings.table";

const row: Settings = { ...defaultSettings, businessId: 5, maxEmails: 500, timezone: "America/New_York" };

const service = (stored: Settings | null) =>
  new SettingsService({
    upsert: async () => {},
    deleteByBusinessId: async () => {},
    findByBusinessId: async () => stored,
  });

describe("SettingsService.getForBusiness", () => {
  it("returns the stored settings", async () => {
    expect(await service(row).getForBusiness(5)).toEqual(row);
  });

  it("falls back to the defaults for a business without settings", async () => {
    expect(await service(null).getForBusiness(9)).toEqual({ ...defaultSettings, businessId: 9 });
  });

  it("replaces an invalid timezone with the default instead of failing every message", async () => {
    const result = await service({ ...row, timezone: "Mars/Olympus" }).getForBusiness(5);
    expect(result.timezone).toBe("Europe/Rome");
  });
});
