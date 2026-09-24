import { describe, expect, it } from "vitest";
import { parseAutomationPayload } from "../../../dispatchers/internal/automation.UPSERT";

const payload = {
  id: 9,
  user_id: 3,
  business_id: 42,
  name: "Welcome",
  field: "status",
  operator: "equals",
  value: "new",
  steps: [
    { stepType: "whatsapp", content: "second", delay: 1, delay_unit: "Hours" },
    { stepType: "email", subject: "Hi", content: "third", step_sequence: 3 },
  ],
};

describe("automation payload", () => {
  it("normalises operators and delay units and orders steps", () => {
    const parsed = parseAutomationPayload(payload);
    expect(parsed.operator).toBe("eq");
    expect(parsed.automationType).toBe("lead");
    expect(parsed.steps.map((s) => [s.step_sequence, s.delay_unit, s.content])).toEqual([
      [1, "hour", "second"],
      [3, "minute", "third"],
    ]);
  });

  it("rejects unsupported operators without echoing message content", () => {
    expect(() => parseAutomationPayload({ ...payload, operator: "regex" })).toThrow(/operator/);
  });

  it.each([
    ["explicit duplicates", [{ step_sequence: 1 }, { step_sequence: 1 }]],
    ["an implicit position colliding with an explicit sequence", [{}, { step_sequence: 1 }]],
  ])("rejects %s", (_case, sequences) => {
    const steps = sequences.map((s) => ({ stepType: "email", content: "x", ...s }));
    expect(() => parseAutomationPayload({ ...payload, steps })).toThrow(/unique/);
  });
});
