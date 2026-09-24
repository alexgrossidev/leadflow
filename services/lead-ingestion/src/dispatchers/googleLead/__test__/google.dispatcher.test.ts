import { describe, it, expect, vi } from "vitest";
import { GoogleLeadDispatcher } from "#dispatchers/googleLead/google.dispatcher";
import { LeadFatalError } from "#modules/fbLead/fbLead.errors";
import type { GoogleLeadProcessPayload } from "@leadflow/shared/jobs";

const payload: GoogleLeadProcessPayload = {
  userId: 1001,
  businessId: 2001,
  responseId: "resp_99",
  createdTime: 1_750_000_000_000,
  answers: [
    { name: "Full Name", values: ["Giulia Bianchi"] },
    { name: "Email", values: ["giulia@example.com"] },
  ],
};

describe("GoogleLeadDispatcher.run", () => {
  it("normalises the answers and delivers under the google_forms source", async () => {
    const deliver = vi.fn().mockResolvedValue(undefined);
    const dispatcher = new GoogleLeadDispatcher({ delivery: { deliver } });

    await dispatcher.run(payload);

    expect(deliver).toHaveBeenCalledTimes(1);
    const [lead, ctx] = deliver.mock.calls[0];
    expect(lead.leadId).toBe("resp_99");
    expect(lead.fullName).toBe("Giulia Bianchi");
    expect(lead.email).toBe("giulia@example.com");
    expect(ctx).toEqual({
      userId: 1001,
      businessId: 2001,
      source: "google_forms",
    });
  });

  it("forwards edge antispam flags as a lead field", async () => {
    const deliver = vi.fn().mockResolvedValue(undefined);
    const dispatcher = new GoogleLeadDispatcher({ delivery: { deliver } });

    await dispatcher.run({ ...payload, flags: ["disposable_email"] });

    const [lead] = deliver.mock.calls[0];
    expect(lead.customFields.spam_flags).toBe("disposable_email");
  });

  it("raises a fatal error when normalisation cannot proceed", async () => {
    const deliver = vi.fn();
    const dispatcher = new GoogleLeadDispatcher({ delivery: { deliver } });

    // An unusable createdTime makes date construction throw; that is not fixed by
    // a retry, so it must surface as fatal rather than silently deliver.
    const bad = { ...payload, createdTime: NaN } as GoogleLeadProcessPayload;

    await expect(dispatcher.run(bad)).rejects.toBeInstanceOf(LeadFatalError);
    expect(deliver).not.toHaveBeenCalled();
  });
});
