import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type { Lead, LeadServiceClient } from "@leadflow/rpc";
import { LeadBackfill } from "../lead.backfill";
import type { AutomationRow } from "../../../modules/automations/automation.table";
import { BATCH_SIZE } from "../../../config/constants";

const automation: AutomationRow = {
  id: 7,
  user_id: 3,
  business_id: 42,
  name: "rule",
  automationType: "lead",
  paused: false,
  pausedAt: null,
  field: "status",
  operator: "eq",
  value: "new",
  scheduledDeletionAt: null,
  created_at: new Date(0),
};

function fakeClient(leads: Lead[]) {
  const calls: Array<{ request: unknown; options: unknown }> = [];
  const client = {
    getLeadWithFilters: (request: unknown, options: unknown) => {
      calls.push({ request, options });
      return Object.assign(Readable.from(leads), { cancel: vi.fn() });
    },
  } as unknown as Pick<LeadServiceClient, "getLeadWithFilters">;
  return { client, calls };
}

describe("LeadBackfill", () => {
  it("streams matching leads into enrolment in bounded batches, with a deadline", async () => {
    const leads = Array.from({ length: BATCH_SIZE + 3 }, (_, i) => ({
      id: String(i + 1),
      name: "",
      email: `lead${i}@leadflow.test`,
      phone: "",
      status: "new",
    }));
    leads.push({ id: "not-a-number", name: "", email: "", phone: "", status: "" });
    const { client, calls } = fakeClient(leads);
    const batches: number[] = [];
    const enrol = vi.fn(async (entries: unknown[]) => {
      batches.push(entries.length);
      return entries.length;
    });

    const enrolled = await new LeadBackfill(client, { enrol }).run(automation);

    expect(enrolled).toBe(BATCH_SIZE + 3);
    expect(batches).toEqual([BATCH_SIZE, 3]);
    expect(calls[0]?.request).toMatchObject({
      businessId: 42,
      type: "field",
      fieldName: "status",
      fieldOperator: "eq",
      fieldValue: "new",
    });
    expect((calls[0]?.options as { deadline: Date }).deadline).toBeInstanceOf(Date);
    expect(enrol.mock.calls[0]?.[0]).toContainEqual({
      automation,
      contact: { originalId: 1, email: "lead0@leadflow.test", phone: null },
    });
  });

  it("asks for every lead when the rule has no field", async () => {
    const { client, calls } = fakeClient([]);
    await new LeadBackfill(client, { enrol: async () => 0 }).run({ ...automation, field: null, operator: null });
    expect(calls[0]?.request).toMatchObject({ type: "all" });
  });
});
