import { describe, it, expect } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
import { customFieldValue } from "../customers.values.table.js";
import {
  buildEavCondition,
  buildValueCondition,
  likePattern,
} from "../customer.query.repo.js";
import { eavFilterSchema, type EavFilter } from "../customers.schema.js";

const dialect = new MySqlDialect();
const render = (condition: SQL) => dialect.sqlToQuery(condition);
const column = customFieldValue.customFieldValue;

const filter = (operator: EavFilter["operator"], value?: string): EavFilter => ({
  fieldSlug: "budget",
  operator,
  value,
});

describe("customer EAV filter builder", () => {
  it("NOT_NULL matches present, non-empty values (not IS NULL)", () => {
    const { sql, params } = render(buildValueCondition(column, filter("NOT_NULL")));
    expect(sql).toBe(
      "(`customers_v2_customvalues`.`customfield_value` IS NOT NULL AND `customers_v2_customvalues`.`customfield_value` <> '')",
    );
    expect(params).toEqual([]);
  });

  it("GREATER_THAN compares numerically when the value is numeric", () => {
    const { sql, params } = render(buildValueCondition(column, filter("GREATER_THAN", "1000")));
    expect(sql).toBe(
      "CAST(`customers_v2_customvalues`.`customfield_value` AS DECIMAL(30, 10)) > CAST(? AS DECIMAL(30, 10))",
    );
    expect(params).toEqual(["1000"]);
  });

  it.each(["-5", "12.5"])("treats %s as numeric", (value) => {
    expect(render(buildValueCondition(column, filter("GREATER_THAN", value))).sql).toContain("CAST(");
  });

  it("GREATER_THAN falls back to string comparison for non-numeric values", () => {
    const { sql, params } = render(buildValueCondition(column, filter("GREATER_THAN", "2024-01-01")));
    expect(sql).toBe("`customers_v2_customvalues`.`customfield_value` > ?");
    expect(params).toEqual(["2024-01-01"]);
  });

  it("EQUAL binds the value as a parameter", () => {
    const { sql, params } = render(buildValueCondition(column, filter("EQUAL", "gold")));
    expect(sql).toBe("`customers_v2_customvalues`.`customfield_value` = ?");
    expect(params).toEqual(["gold"]);
  });

  it("CONTAINS escapes LIKE wildcards in user input", () => {
    const { params } = render(buildValueCondition(column, filter("CONTAINS", "50%_off")));
    expect(params).toEqual(["%50\\%\\_off%"]);
    expect(likePattern("a\\b")).toBe("%a\\\\b%");
  });

  it("scopes an EAV condition to its field slug", () => {
    const { sql, params } = render(buildEavCondition(filter("EQUAL", "gold")));
    expect(sql).toContain("`customers_v2_customfields`.`field` = ?");
    expect(params).toEqual(["budget", "gold"]);
  });

  it("requires a value for every operator except NOT_NULL", () => {
    expect(eavFilterSchema.safeParse({ fieldSlug: "x", operator: "NOT_NULL" }).success).toBe(true);
    expect(eavFilterSchema.safeParse({ fieldSlug: "x", operator: "GREATER_THAN" }).success).toBe(false);
    expect(eavFilterSchema.safeParse({ fieldSlug: "x", operator: "EQUAL", value: "" }).success).toBe(false);
  });
});
