import { describe, it, expect } from "vitest";
import { isTenantKey } from "../filestorage.js";

describe("isTenantKey", () => {
  it.each([
    ["CUSTOMER_BULK_IMPORT/3/7/customers-1700000000000-ab12cd34.csv", true],
    ["CUSTOMER_BULK_IMPORT/99/7/file-1-ab.xlsx", true],
    ["CUSTOMER_BULK_IMPORT/3/8/customers-1700000000000-ab12cd34.csv", false], // other business
    ["CUSTOMER_DOCUMENT/3/7/contract-1-ab.pdf", false], // other key space
    ["CUSTOMER_BULK_IMPORT/3/7/../8/x.csv", false], // traversal / nesting
    ["CUSTOMER_BULK_IMPORT/3/7/", false],
    ["CUSTOMER_BULK_IMPORT/x/7/a.csv", false],
    ["other/CUSTOMER_BULK_IMPORT/3/7/a.csv", false],
  ])("%s -> %s", (key, expected) => {
    expect(isTenantKey(key, "CUSTOMER_BULK_IMPORT", 7)).toBe(expected);
  });
});
