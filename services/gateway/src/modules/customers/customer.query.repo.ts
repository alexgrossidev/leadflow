import {
  SQL,
  and,
  desc,
  eq,
  exists,
  isNull,
  like,
  or,
  sql,
  type AnyColumn,
} from "drizzle-orm";
import { mainDb } from "#database/mainPool";
import { customers } from "./customers.table.js";
import { customField } from "./customers.fields.table.js";
import { customFieldValue } from "./customers.values.table.js";
import { assignedServices } from "../customerAssigned/assigned.table.js";
import { services } from "../services/services.table.js";
import { customerDocuments } from "../customerDocuments/cusdocs.table.js";
import { CustomerSearchQuery, EavFilter } from "./customers.schema.js";

/** Filters on these slugs hit the customers table directly instead of the EAV tables. */
const CORE_FIELDS = {
  name: customers.name,
  email: customers.email,
  phone: customers.phone,
} as const;

type CoreField = keyof typeof CORE_FIELDS;

const isCoreField = (slug: string): slug is CoreField => slug in CORE_FIELDS;

const NUMERIC = /^-?\d+(\.\d+)?$/;

/** Escapes LIKE wildcards so user input is matched literally. */
export function likePattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/**
 * Translates one filter operator into a predicate on `column`. Values that
 * look numeric are compared numerically: as strings, "9" > "10".
 */
export function buildValueCondition(column: AnyColumn | SQL, filter: EavFilter): SQL {
  const value = filter.value ?? "";
  switch (filter.operator) {
    case "EQUAL":
      return sql`${column} = ${value}`;
    case "CONTAINS":
      return sql`${column} LIKE ${likePattern(value)}`;
    case "NOT_NULL":
      return sql`(${column} IS NOT NULL AND ${column} <> '')`;
    case "GREATER_THAN":
      return NUMERIC.test(value)
        ? sql`CAST(${column} AS DECIMAL(30, 10)) > CAST(${value} AS DECIMAL(30, 10))`
        : sql`${column} > ${value}`;
    default: {
      const unsupported: never = filter.operator;
      throw new Error(`Unsupported filter operator: ${String(unsupported)}`);
    }
  }
}

/** Predicate matching one EAV row (field definition joined to its value). */
export function buildEavCondition(filter: EavFilter): SQL {
  return and(
    eq(customField.field, filter.fieldSlug),
    buildValueCondition(customFieldValue.customFieldValue, filter),
  )!;
}

/** Narrows by the free-text `name` according to the chosen search type. */
function buildSearchCondition(
  businessId: number,
  query: CustomerSearchQuery,
): SQL | undefined {
  if (!query.name) return undefined;
  const pattern = likePattern(query.name);

  switch (query.searchType) {
    case "name":
      return like(customers.name, pattern);
    case "service":
      return exists(
        mainDb
          .select({ one: sql`1` })
          .from(assignedServices)
          .innerJoin(services, eq(assignedServices.serviceId, services.id))
          .where(
            and(
              eq(assignedServices.businessId, businessId),
              eq(assignedServices.customerId, customers.id),
              isNull(assignedServices.deletedAt),
              like(services.name, pattern),
            ),
          ),
      );
    case "attachment":
      return exists(
        mainDb
          .select({ one: sql`1` })
          .from(customerDocuments)
          .where(
            and(
              eq(customerDocuments.businessId, businessId),
              eq(customerDocuments.customerId, customers.id),
              isNull(customerDocuments.deletedAt),
              or(
                like(customerDocuments.fileName, pattern),
                like(customerDocuments.note, pattern),
              ),
            ),
          ),
      );
    default: {
      const unsupported: never = query.searchType;
      throw new Error(`Unsupported search type: ${String(unsupported)}`);
    }
  }
}

export class CustomerQueryRepository {
  /**
   * Returns one page of matching customer ids plus the total match count.
   *
   * Core-column filters become plain WHERE clauses. Custom-field filters use
   * relational division: join each customer to its EAV rows, keep the rows
   * matching any filter, and require the number of distinct matched fields to
   * equal the number of filtered fields (i.e. every filter matched).
   */
  async findCustomerIds(
    businessId: number,
    query: CustomerSearchQuery,
  ): Promise<{ customerIds: number[]; totalCount: number }> {
    const offset = (query.page - 1) * query.limit;

    const conditions: SQL[] = [
      eq(customers.businessId, businessId),
      isNull(customers.deletedAt),
    ];
    const search = buildSearchCondition(businessId, query);
    if (search) conditions.push(search);

    const eavFilters: EavFilter[] = [];
    for (const filter of query.eavFilters) {
      if (isCoreField(filter.fieldSlug)) {
        conditions.push(buildValueCondition(CORE_FIELDS[filter.fieldSlug], filter));
      } else {
        eavFilters.push(filter);
      }
    }

    if (eavFilters.length === 0) {
      const [countRow] = await mainDb
        .select({ count: sql<number>`count(*)` })
        .from(customers)
        .where(and(...conditions));
      const totalCount = Number(countRow?.count ?? 0);
      if (totalCount === 0) return { customerIds: [], totalCount: 0 };

      const rows = await mainDb
        .select({ id: customers.id })
        .from(customers)
        .where(and(...conditions))
        .orderBy(desc(customers.id))
        .limit(query.limit)
        .offset(offset);
      return { customerIds: rows.map((r) => r.id), totalCount };
    }

    const requiredMatches = new Set(eavFilters.map((f) => f.fieldSlug)).size;
    const matching = mainDb
      .select({ id: customers.id })
      .from(customers)
      .innerJoin(customFieldValue, eq(customers.id, customFieldValue.customerId))
      .innerJoin(customField, eq(customFieldValue.customFieldId, customField.id))
      .where(
        and(
          ...conditions,
          eq(customField.businessId, businessId),
          isNull(customField.deletedAt),
          or(...eavFilters.map(buildEavCondition)),
        ),
      )
      .groupBy(customers.id)
      .having(eq(sql`count(distinct ${customField.field})`, requiredMatches))
      .as("matching");

    const [countRow] = await mainDb
      .select({ count: sql<number>`count(*)` })
      .from(matching);
    const totalCount = Number(countRow?.count ?? 0);
    if (totalCount === 0) return { customerIds: [], totalCount: 0 };

    const rows = await mainDb
      .select({ id: matching.id })
      .from(matching)
      .orderBy(desc(matching.id))
      .limit(query.limit)
      .offset(offset);
    return { customerIds: rows.map((r) => r.id), totalCount };
  }
}
