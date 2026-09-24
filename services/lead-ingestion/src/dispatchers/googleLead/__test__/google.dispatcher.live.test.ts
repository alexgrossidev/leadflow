import { describe, it, expect } from "vitest";
import { GoogleLeadDispatcher } from "../google.dispatcher";
import type { GoogleLeadProcessPayload } from "@leadflow/shared/jobs";

/**
 * Live tier: drives a Google lead through NORMALISE → DELIVER against a real
 * gateway and database using the ambient .env. Excluded from `vitest run` by
 * the config and additionally gated on LIVE_GOOGLE=1, because it writes a lead
 * to the gateway and a row to lead_delivery.
 *
 * Set LIVE_GOOGLE_USER / LIVE_GOOGLE_BUSINESS to a non-production tenant.
 */
const live = process.env.LIVE_GOOGLE === "1";

describe.runIf(live)("GoogleLeadDispatcher (live delivery)", () => {
  it("delivers a test lead to the gateway under the google_forms source", async () => {
    const payload: GoogleLeadProcessPayload = {
      userId: Number(process.env.LIVE_GOOGLE_USER),
      businessId: Number(process.env.LIVE_GOOGLE_BUSINESS),
      responseId: `live_${Date.now()}`,
      createdTime: Date.now(),
      answers: [
        { name: "Full Name", values: ["Live Test Lead"] },
        { name: "Email", values: ["live-test@example.com"] },
      ],
    };

    // Uses the real gateway delivery (default); no injected sink.
    await expect(new GoogleLeadDispatcher().run(payload)).resolves.toBeUndefined();
  });
});
