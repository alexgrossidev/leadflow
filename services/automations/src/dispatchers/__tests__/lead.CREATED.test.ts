import { describe, expect, it } from "vitest";
import { JobNames } from "@leadflow/shared/jobs";
import type { LeadCreatedPayload } from "@leadflow/shared";
import { createLeadCreatedHandler } from "../lead.CREATED";
import { EnrolmentService, type EnrolmentStore } from "../../modules/enrolment/enrolment.service";
import type { AutomationRow } from "../../modules/automations/automation.table";
import { FakeQueue } from "../../__tests__/fakeQueue";

const base: AutomationRow = {
  id: 1,
  user_id: 3,
  business_id: 42,
  name: "rule",
  automationType: "lead",
  paused: false,
  pausedAt: null,
  field: null,
  operator: null,
  value: null,
  scheduledDeletionAt: null,
  created_at: new Date(0),
};

const lead: LeadCreatedPayload = {
  leadId: 100,
  businessId: 42,
  userId: 5,
  source: "facebook",
  fullName: "Ada Lovelace",
  email: "ada@leadflow.test",
  phone: null,
  fields: { city: "Milano" },
  createdAt: "2026-03-10T09:00:00.000Z",
};

describe("lead.created", () => {
  it("enrols the lead in every matching automation, in one store call, once", async () => {
    const saved: Parameters<EnrolmentStore["saveEnrolments"]>[] = [];
    const store: EnrolmentStore = { saveEnrolments: async (...args) => void saved.push(args) };
    const queue = new FakeQueue();
    const automations = [
      { ...base, id: 1 },
      { ...base, id: 2, field: "city", operator: "eq", value: "milano" },
      { ...base, id: 3, field: "city", operator: "eq", value: "roma" },
    ];
    const handler = createLeadCreatedHandler({
      automations: { listActive: async () => automations },
      enrolment: new EnrolmentService(store, queue, () => new Date("2026-03-10T09:00:00.000Z")),
    });

    await handler(lead);
    await handler(lead); // redelivered event

    expect(saved[0]?.[0]).toEqual([
      expect.objectContaining({ originalId: 100, type: "lead", businessId: 42, email: "ada@leadflow.test" }),
    ]);
    expect(saved[0]?.[1].map((t) => t.automationId)).toEqual([1, 2]);
    const launches = queue.of(JobNames.AUTOMATION_EXECUTE_INTERNAL);
    expect(launches.map((j) => j.data.automationId)).toEqual([1, 2]);
    expect(queue.ignored).toHaveLength(2);
  });
});
