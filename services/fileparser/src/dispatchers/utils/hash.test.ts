import { describe, expect, it } from "vitest";
import { customerHash, dedupHash } from "./hash.js";

describe("dedupHash", () => {
  const row = { Name: "Ada", Email: "ada@example.com", Phone: "123" };

  it("is a stable 32-byte sha256 digest", () => {
    const first = dedupHash(row);
    expect(first).toHaveLength(32);
    expect(dedupHash({ ...row }).equals(first)).toBe(true);
  });

  it("does not depend on column order", () => {
    const reordered = { Phone: "123", Email: "ada@example.com", Name: "Ada" };
    expect(dedupHash(reordered).equals(dedupHash(row))).toBe(true);
  });

  it("changes when any value, header or type changes", () => {
    const base = dedupHash(row);
    expect(dedupHash({ ...row, Phone: "124" }).equals(base)).toBe(false);
    expect(dedupHash({ Name: "Ada", Mail: "ada@example.com", Phone: "123" }).equals(base)).toBe(false);
    expect(dedupHash({ ...row, Phone: 123 }).equals(base)).toBe(false);
  });

  it("does not let a value masquerade as a header boundary", () => {
    expect(dedupHash({ a: "b,c" }).equals(dedupHash({ "a,b": "c" }))).toBe(false);
  });
});

describe("customerHash", () => {
  const customer = {
    name: "Ada Lovelace",
    email: "Ada@Example.com",
    phone: "+44 20 0000",
    customFields: { industry: "Computing", language: "English" },
  };

  it("is hex sha256", () => {
    expect(customerHash(customer)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("ignores case, surrounding whitespace, phone spacing and field order", () => {
    const variant = {
      name: "  ada lovelace ",
      email: "ada@example.com ",
      phone: "+442000 00",
      customFields: { language: "English", industry: "Computing" },
    };
    expect(customerHash(variant)).toBe(customerHash(customer));
  });

  it("distinguishes different custom-field values", () => {
    const other = { ...customer, customFields: { ...customer.customFields, industry: "Math" } };
    expect(customerHash(other)).not.toBe(customerHash(customer));
  });
});
