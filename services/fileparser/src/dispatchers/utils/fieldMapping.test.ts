import { describe, expect, it } from "vitest";
import {
  buildPreferences,
  mapRowToCustomer,
  prepareColumnSettings,
} from "./fieldMapping.js";

const row = {
  Name: "Ada Lovelace",
  Email: "ada@example.com",
  Phone: "+44 20 0000 0000",
  favoritelanguage: "English",
  industry: "Computing",
  notes: "met at conference",
};

describe("prepareColumnSettings", () => {
  it("defaults to empty lookups when settings are missing", () => {
    const prepared = prepareColumnSettings(undefined);
    expect(prepared.deletionSet.size).toBe(0);
    expect(prepared.importSet.size).toBe(0);
    expect(prepared.mergeMap.size).toBe(0);
  });
});

describe("buildPreferences", () => {
  const cases: Array<{
    name: string;
    settings: Parameters<typeof prepareColumnSettings>[0];
    input?: Record<string, unknown>;
    expected: Record<string, string>;
  }> = [
    {
      name: "imports every non-core column when there is no mapping plan",
      settings: undefined,
      expected: { favoritelanguage: "English", industry: "Computing", notes: "met at conference" },
    },
    {
      name: "drops deleted columns in the default plan",
      settings: { fieldsToDelete: ["notes"], import: [], merges: [] },
      expected: { favoritelanguage: "English", industry: "Computing" },
    },
    {
      name: "renames merged columns to their target key",
      settings: { fieldsToDelete: [], import: [], merges: [{ fieldName: "favoritelanguage", target: "language" }] },
      expected: { language: "English" },
    },
    {
      name: "imports new columns under their own header",
      settings: { fieldsToDelete: [], import: ["industry"], merges: [] },
      expected: { industry: "Computing" },
    },
    {
      name: "deletion wins over import and merge",
      settings: {
        fieldsToDelete: ["industry", "language"],
        import: ["industry"],
        merges: [{ fieldName: "favoritelanguage", target: "language" }],
      },
      expected: {},
    },
    {
      name: "concatenates two sources that resolve to the same key",
      settings: {
        fieldsToDelete: [],
        import: ["industry"],
        merges: [{ fieldName: "notes", target: "industry" }],
      },
      expected: { industry: "met at conference, Computing" },
    },
    {
      name: "ignores mapped columns the row does not have",
      settings: { fieldsToDelete: [], import: ["missing"], merges: [{ fieldName: "nope", target: "x" }] },
      expected: {},
    },
    {
      name: "skips empty values and trims the rest",
      settings: undefined,
      input: { a: "n", b: "e", c: "p", blank: "   ", nil: null, padded: "  v  ", num: 42 },
      expected: { padded: "v", num: "42" },
    },
  ];

  it.each(cases)("$name", ({ settings, input, expected }) => {
    expect(buildPreferences(input ?? row, prepareColumnSettings(settings))).toEqual(expected);
  });
});

describe("mapRowToCustomer", () => {
  it.each([
    {
      name: "maps the first three columns positionally, whatever their headers",
      input: row,
      expected: { name: "Ada Lovelace", email: "ada@example.com", phone: "+44 20 0000 0000" },
    },
    {
      name: "coerces missing and null identity cells to empty strings",
      input: { onlyName: " Bob " , email: null },
      expected: { name: "Bob", email: "", phone: "" },
    },
    {
      name: "stringifies numeric phone cells from spreadsheets",
      input: { n: "Carla", e: "", p: 393331234567 },
      expected: { name: "Carla", email: "", phone: "393331234567" },
    },
  ])("$name", ({ input, expected }) => {
    const customer = mapRowToCustomer(input, prepareColumnSettings(undefined));
    expect(customer).toMatchObject(expected);
  });
});
