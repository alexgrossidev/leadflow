import crypto from "crypto";
import { describe, it, expect, vi } from "vitest";
import { GoogleService } from "#modules/google/google.service";
import {
  GoogleLeadWebhookPayloadSchema,
  type GoogleLeadWebhookPayload,
} from "#modules/google/google.schema";
import { InvalidGoogleSignatureError } from "#modules/google/google.errors";
import { JobNames } from "@leadflow/shared/jobs";

const SECRET = "svc-secret";
const sign = (body: string) =>
  "sha256=" + crypto.createHmac("sha256", SECRET).update(body).digest("hex");

const validPayload: GoogleLeadWebhookPayload = {
  userId: 1001,
  businessId: 2001,
  formId: "form_abc",
  responseId: "resp_42",
  createdTime: 1_750_000_000_000,
  answers: [{ name: "Email", values: ["mario@example.com"] }],
};

function makeService() {
  const enqueue = vi.fn().mockResolvedValue("job-id");
  const service = new GoogleService({ secret: SECRET, queue: { enqueue } });
  return { service, enqueue };
}

describe("GoogleService.assertValidSignature", () => {
  it("passes a valid signature and throws on an invalid one", () => {
    const { service } = makeService();
    const body = JSON.stringify(validPayload);

    expect(() => service.assertValidSignature(body, sign(body))).not.toThrow();
    expect(() => service.assertValidSignature(body, "sha256=bad")).toThrow(
      InvalidGoogleSignatureError,
    );
  });
});

describe("GoogleService.enqueueLead", () => {
  it("enqueues GOOGLE_LEAD_PROCESS with a responseId-scoped jobId and retry policy", async () => {
    const { service, enqueue } = makeService();

    await service.enqueueLead(validPayload);

    expect(enqueue).toHaveBeenCalledTimes(1);
    const [name, data, opts] = enqueue.mock.calls[0];
    expect(name).toBe(JobNames.GOOGLE_LEAD_PROCESS);
    expect(data).toEqual({
      userId: 1001,
      businessId: 2001,
      formId: "form_abc",
      responseId: "resp_42",
      createdTime: 1_750_000_000_000,
      answers: [{ name: "Email", values: ["mario@example.com"] }],
    });
    expect(opts.jobId).toBe("glead_resp_42");
    expect(opts.attempts).toBe(5);
  });
});

describe("GoogleLeadWebhookPayloadSchema", () => {
  it("rejects a payload missing responseId", () => {
    const { responseId, ...rest } = validPayload;
    expect(GoogleLeadWebhookPayloadSchema.safeParse(rest).success).toBe(false);
  });

  it("requires createdTime, which bounds the replay window", () => {
    const { createdTime, ...rest } = validPayload;
    expect(GoogleLeadWebhookPayloadSchema.safeParse(rest).success).toBe(false);
  });

  it("rejects a non-positive tenant id", () => {
    expect(
      GoogleLeadWebhookPayloadSchema.safeParse({ ...validPayload, userId: 0 })
        .success,
    ).toBe(false);
  });
});
