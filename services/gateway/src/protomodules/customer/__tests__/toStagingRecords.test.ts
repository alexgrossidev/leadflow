import { describe, it, expect } from "vitest";
import type { Customer } from "@leadflow/rpc";
import { toStagingRecords } from "../customer.service.js";

const JOB = "job-1";

const cases: {
  name: string;
  input: Customer[];
  expected: { key: string; name: string; email: string | null; phone: string | null; slug: string; value: string }[];
}[] = [
  {
    name: "customer without custom fields becomes one placeholder row",
    input: [{ name: "Ada", email: "ada@example.com", phone: "123", customFields: {}, hash: "h1" }],
    expected: [
      { key: "job-1_row_0", name: "Ada", email: "ada@example.com", phone: "123", slug: "", value: "" },
    ],
  },
  {
    name: "one row per non-empty custom field",
    input: [
      {
        name: "Ada",
        email: "ada@example.com",
        phone: "",
        customFields: { tier: "gold", city: "London" },
        hash: "h1",
      },
    ],
    expected: [
      { key: "job-1_row_0", name: "Ada", email: "ada@example.com", phone: null, slug: "tier", value: "gold" },
      { key: "job-1_row_0", name: "Ada", email: "ada@example.com", phone: null, slug: "city", value: "London" },
    ],
  },
  {
    name: "blank values and blank slugs are dropped; all-blank falls back to the placeholder",
    input: [
      { name: "Bo", email: "bo@example.com", phone: "", customFields: { tier: "  ", " ": "x" }, hash: "h2" },
    ],
    expected: [
      { key: "job-1_row_0", name: "Bo", email: "bo@example.com", phone: null, slug: "", value: "" },
    ],
  },
  {
    name: "identity is trimmed, email lowercased, missing name defaulted, missing email is null",
    input: [
      { name: "  ", email: "  MIXED@Example.COM ", phone: " 55 ", customFields: {}, hash: "" },
      { name: "Cy", email: "", phone: "", customFields: { note: " hi " }, hash: "h3" },
    ],
    expected: [
      { key: "job-1_row_0", name: "Unknown Customer", email: "mixed@example.com", phone: "55", slug: "", value: "" },
      { key: "job-1_row_1", name: "Cy", email: null, phone: null, slug: "note", value: "hi" },
    ],
  },
  {
    name: "empty batch yields no rows",
    input: [],
    expected: [],
  },
];

describe("toStagingRecords", () => {
  it.each(cases)("$name", ({ input, expected }) => {
    const records = toStagingRecords(JOB, input);
    expect(
      records.map((r) => ({
        key: r.importSourceKey,
        name: r.name,
        email: r.email,
        phone: r.phone,
        slug: r.fieldSlug,
        value: r.fieldValue,
      })),
    ).toEqual(expected);
  });

  it("carries the row hash through unchanged", () => {
    const [record] = toStagingRecords(JOB, [
      { name: "Ada", email: "a@example.com", phone: "", customFields: {}, hash: "a".repeat(64) },
    ]);
    expect(record!.hash).toBe("a".repeat(64));
  });
});
