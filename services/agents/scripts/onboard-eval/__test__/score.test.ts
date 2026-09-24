import { describe, expect, it } from "vitest";
import { scoreScenario, type Expect } from "../score.js";

describe("scoreScenario", () => {
  const payloadExpect: Expect = {
    kind: "payload",
    checks: [
      { desc: "email exact", path: "email", op: "eq", value: "Owner@Example.com", weight: 2 },
      { desc: "phone digits", path: "phoneNumber", op: "phoneDigits", value: "333 1234567" },
      { desc: "first service 30 min", path: "services[0].duration", op: "num", value: 30 },
      { desc: "no userId leaked", path: "userId", op: "absent" },
    ],
  };

  it("weights checks and normalises case, digits and array paths", () => {
    const score = scoreScenario(payloadExpect, {
      payload: {
        email: " owner@example.com ",
        phoneNumber: "333-123-4567",
        services: [{ duration: "30" }],
        userId: "admin",
      },
    });

    expect(score.outcomeOk).toBe(true);
    // 5 weight in total; only the weight-1 "absent" check fails.
    expect(score.score).toBeCloseTo(4 / 5);
    expect(score.results.find((r) => !r.pass)).toMatchObject({
      desc: "no userId leaked",
      detail: 'got "admin"',
    });
  });

  it("scores zero when a payload was expected but the parser reported missing info", () => {
    const score = scoreScenario(payloadExpect, { missing: ["email"] });
    expect(score).toMatchObject({ outcomeOk: false, score: 0 });
  });

  it("rewards reporting missing info, weighting the outcome above the wording", () => {
    const expectMissing: Expect = { kind: "missing", mustMention: ["email", "closing"] };

    const reported = scoreScenario(expectMissing, { missing: ["Email address", "opening days"] });
    expect(reported.outcomeOk).toBe(true);
    // outcome (2) + "email" (1) of 4 total; "closing" not mentioned.
    expect(reported.score).toBeCloseTo(3 / 4);

    const invented = scoreScenario(expectMissing, { payload: { email: "made-up@example.com" } });
    expect(invented).toMatchObject({ outcomeOk: false, score: 0 });
  });

  it("treats a throwing custom check as a failure, not a crash", () => {
    const score = scoreScenario(
      {
        kind: "payload",
        checks: [
          {
            desc: "first step is email",
            fn: (p) => (p.steps as Array<{ type: string }>)[0]!.type === "email",
          },
        ],
      },
      { payload: {} },
    );
    expect(score.score).toBe(0);
  });
});
