import { describe, it, expect } from "vitest";
import {
  asJsonObject,
  isParsed,
  needsDelivery,
  needsFetch,
} from "#dispatchers/lead/lead.logic";
import type { FacebookLead } from "#modules/fbLead/fbLead.table";

describe("asJsonObject", () => {
  it("passes a plain object through", () => {
    expect(asJsonObject({ a: 1 })).toEqual({ a: 1 });
  });

  it("unwraps a single JSON-encoded string", () => {
    expect(asJsonObject('{"a":1}')).toEqual({ a: 1 });
  });

  it("unwraps a double-encoded string", () => {
    expect(asJsonObject(JSON.stringify(JSON.stringify({ leadId: "x" })))).toEqual({
      leadId: "x",
    });
  });

  it.each([null, undefined, 42, "not json", "[1,2]", [1, 2], '"just a string"'])(
    "returns null for non-objects: %j",
    (value) => {
      expect(asJsonObject(value)).toBeNull();
    },
  );
});

describe("lead stage guards", () => {
  const row = (over: Partial<FacebookLead>) => over as FacebookLead;

  it("needsFetch until the row is fetched", () => {
    expect(needsFetch(null)).toBe(true);
    expect(needsFetch(row({ fetched: false }))).toBe(true);
    expect(needsFetch(row({ fetched: true }))).toBe(false);
  });

  it("isParsed only for a clean_response that is a real lead", () => {
    expect(isParsed(row({ cleanResponse: {} }))).toBe(false);
    // A string-encoded placeholder must not masquerade as parsed.
    expect(isParsed(row({ cleanResponse: '"{}"' }))).toBe(false);
    expect(isParsed(row({ cleanResponse: { leadId: "x", customFields: {} } }))).toBe(true);
  });

  it("needsDelivery until delivered", () => {
    expect(needsDelivery(null)).toBe(false);
    expect(needsDelivery(row({ delivered: false }))).toBe(true);
    expect(needsDelivery(row({ delivered: true }))).toBe(false);
  });
});
