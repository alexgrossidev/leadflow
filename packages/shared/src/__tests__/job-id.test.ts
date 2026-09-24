import { describe, expect, it } from "vitest";
import { toJobId } from "../queue/bullmq.provider";

describe("toJobId", () => {
  it("replaces BullMQ's reserved ':' separator", () => {
    expect(toJobId("whatsapp:42:7:+390000000000:ab12")).toBe("whatsapp_42_7_+390000000000_ab12");
  });

  it("is stable, so the same natural key always dedupes to the same job", () => {
    expect(toJobId("a:b")).toBe(toJobId("a:b"));
  });

  it("leaves ids without ':' untouched", () => {
    expect(toJobId("lead_123")).toBe("lead_123");
  });
});
