import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "events";
import { status } from "@grpc/grpc-js";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { GrpcError, type GetLeadWithFiltersRequest, type Lead, type ServerWritableStream } from "@leadflow/rpc";
import { LeadStreamingService } from "../lead.service.js";
import type { LeadStreamRepository, LeadStreamRow } from "../lead.repo.js";
import { buildLeadFieldCondition, type LeadFieldFilter } from "../lead.filter.js";

/** Minimal stand-in for a grpc-js server stream with a controllable buffer. */
class FakeCall extends EventEmitter {
  written: Lead[] = [];
  ended = false;
  cancelled = false;
  constructor(
    public request: GetLeadWithFiltersRequest,
    private readonly highWaterMark = Infinity,
  ) {
    super();
  }
  write(lead: Lead): boolean {
    this.written.push(lead);
    return this.written.length % this.highWaterMark !== 0;
  }
  end() {
    this.ended = true;
  }
  cancel() {
    this.cancelled = true;
    this.emit("cancelled");
  }
}

const rows = (from: number, count: number): LeadStreamRow[] =>
  Array.from({ length: count }, (_, i) => ({
    id: from + i,
    name: `Lead ${from + i}`,
    email: null,
    phone: null,
    status: "new",
  }));

function makeRepo(pages: LeadStreamRow[][], owns = true) {
  const pagesFn = vi.fn(async function* (_businessId: number, _condition: unknown, _batchSize: number) {
    for (const page of pages) yield page;
  });
  return {
    repo: {
      businessBelongsToUser: vi.fn().mockResolvedValue(owns),
      pages: pagesFn,
    } as unknown as LeadStreamRepository,
    pagesFn,
  };
}

const asCall = (call: FakeCall) => call as unknown as ServerWritableStream<GetLeadWithFiltersRequest, Lead>;
const allRequest = { userId: 1, businessId: 7, type: "all" };

describe("LeadStreamingService.getLeads", () => {
  it("streams every page and ends the call", async () => {
    const { repo, pagesFn } = makeRepo([rows(1, 3), rows(4, 2)]);
    const call = new FakeCall(allRequest);

    await new LeadStreamingService(repo).getLeads(asCall(call));

    expect(call.written.map((l) => l.id)).toEqual(["1", "2", "3", "4", "5"]);
    expect(call.written[0]).toEqual({ id: "1", name: "Lead 1", email: "", phone: "", status: "new" });
    expect(call.ended).toBe(true);
    expect(pagesFn).toHaveBeenCalledWith(7, undefined, 500);
  });

  it("waits for 'drain' when the stream buffer is full", async () => {
    const { repo } = makeRepo([rows(1, 4)]);
    const call = new FakeCall(allRequest, 2);
    const done = new LeadStreamingService(repo).getLeads(asCall(call));

    await new Promise((r) => setImmediate(r));
    expect(call.written).toHaveLength(2); // paused on backpressure
    call.emit("drain");
    await new Promise((r) => setImmediate(r));
    expect(call.written).toHaveLength(4);
    call.emit("drain");
    await done;
    expect(call.ended).toBe(true);
  });

  it("stops without end() when the client cancels", async () => {
    const { repo } = makeRepo([rows(1, 4), rows(5, 4)]);
    const call = new FakeCall(allRequest, 2);
    const done = new LeadStreamingService(repo).getLeads(asCall(call));

    await new Promise((r) => setImmediate(r));
    call.cancel();
    await done;

    expect(call.written).toHaveLength(2);
    expect(call.ended).toBe(false);
  });

  it("passes a field filter through to the repository", async () => {
    const { repo, pagesFn } = makeRepo([]);
    const call = new FakeCall({
      ...allRequest,
      type: "field",
      fieldName: "budget",
      fieldOperator: "gt",
      fieldValue: "1000",
    });

    await new LeadStreamingService(repo).getLeads(asCall(call));
    expect(pagesFn.mock.calls[0]![1]).toBeDefined();
    expect(call.ended).toBe(true);
  });

  it("rejects an invalid request with INVALID_ARGUMENT", async () => {
    const { repo } = makeRepo([]);
    const call = new FakeCall({ ...allRequest, type: "field", fieldName: "x", fieldOperator: "like" });

    const error = await new LeadStreamingService(repo).getLeads(asCall(call)).catch((e) => e);
    expect(error).toBeInstanceOf(GrpcError);
    expect(error.code).toBe(status.INVALID_ARGUMENT);
    expect(call.ended).toBe(false);
  });

  it("rejects a business that does not belong to the user with PERMISSION_DENIED", async () => {
    const { repo } = makeRepo([rows(1, 1)], false);
    const error = await new LeadStreamingService(repo)
      .getLeads(asCall(new FakeCall(allRequest)))
      .catch((e) => e);
    expect(error.code).toBe(status.PERMISSION_DENIED);
  });
});

describe("buildLeadFieldCondition", () => {
  const dialect = new MySqlDialect();
  const render = (f: Omit<LeadFieldFilter, "type" | "userId" | "businessId">) =>
    dialect.sqlToQuery(buildLeadFieldCondition({ type: "field", userId: 1, businessId: 7, ...f }));

  const IS_SET = "(`leads`.`status` IS NOT NULL AND TRIM(`leads`.`status`) <> '')";

  it("compares core columns case-insensitively, trimmed, with the value bound", () => {
    const { sql, params } = render({ fieldName: "status", fieldOperator: "eq", fieldValue: "  New " });
    expect(sql).toBe(`(${IS_SET} AND LOWER(TRIM(\`leads\`.\`status\`)) = ?)`);
    expect(params).toEqual(["new"]);
  });

  it("maps full_name to the name column", () => {
    expect(render({ fieldName: "full_name", fieldOperator: "is_set", fieldValue: "" }).sql).toContain(
      "`leads`.`name` IS NOT NULL",
    );
  });

  it("binds a custom field slug as a JSON path parameter, never as SQL", () => {
    const { sql, params } = render({
      fieldName: 'budget"; DROP TABLE leads; --',
      fieldOperator: "eq",
      fieldValue: "1",
    });
    expect(sql).not.toContain("DROP");
    expect(sql).toContain("JSON_UNQUOTE(JSON_EXTRACT(`leads`.`custom_fields`, ?))");
    expect(params).toContain('$."budget\\"; DROP TABLE leads; --"');
  });

  it("compares numerically only when both sides are numbers", () => {
    const { sql } = render({ fieldName: "budget", fieldOperator: "lt", fieldValue: "10" });
    expect(sql).toContain("REGEXP ?");
    expect(sql).toContain("AS DECIMAL(30, 10)) < CAST(? AS DECIMAL(30, 10))");
    expect(sql).toMatch(/ELSE LOWER\(TRIM\(.*\)\) < \? END/);
  });

  it("uses text ordering for non-numeric values", () => {
    const { sql } = render({ fieldName: "status", fieldOperator: "gt", fieldValue: "b" });
    expect(sql).not.toContain("DECIMAL");
  });

  // Shared with automations' matchesRule: a missing value behaves like SQL NULL,
  // so it satisfies only is_not_set — not even neq.
  it.each(["eq", "neq", "contains", "gt", "lt"] as const)("%s requires the field to be set", (op) => {
    expect(render({ fieldName: "status", fieldOperator: op, fieldValue: "lost" }).sql.startsWith(`(${IS_SET} AND `)).toBe(true);
  });

  it("is_not_set matches NULL, empty or whitespace-only", () => {
    expect(render({ fieldName: "status", fieldOperator: "is_not_set", fieldValue: "" }).sql).toBe(`NOT ${IS_SET}`);
  });

  it("escapes LIKE wildcards in contains", () => {
    const { params } = render({ fieldName: "status", fieldOperator: "contains", fieldValue: "50%_off" });
    expect(params).toContain("%50\\%\\_off%");
  });
});
