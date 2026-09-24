/**
 * Deterministic scorer for one field parse. Structured keys (enums, numbers,
 * emails, counts, ISO times) are checked exactly; free-form prose (about,
 * description, message body) is only checked for presence; its wording is left
 * to review, not graded. A scenario either expects a payload (with per-key
 * checks) or expects the parser to report the field incomplete.
 */

export type Payload = Record<string, unknown>;

/** Outcome captured from parseField for scoring. */
export interface Parse {
  payload?: Payload;
  missing?: string[];
}

export type Op =
  | "eq" // normalised string/number equality
  | "num" // numeric equality
  | "phoneDigits" // equality on digits only
  | "iContains" // case-insensitive substring
  | "len" // array length equals value
  | "gte" // number, or array length, >= value
  | "oneOf" // value is one of value[]
  | "present" // path exists and is non-empty
  | "absent" // path missing or empty
  | "hourUTC"; // ISO date-time whose UTC hour equals value

export interface Check {
  desc: string;
  /** Relative importance; critical keys weigh more. Default 1. */
  weight?: number;
  path?: string;
  op?: Op;
  value?: unknown;
  /** Escape hatch for existence checks a path DSL can't express (e.g. "a Monday with opening 9"). */
  fn?: (payload: Payload) => boolean;
}

export type Expect =
  | { kind: "payload"; checks: Check[] }
  | { kind: "missing"; mustMention?: string[] };

export interface CheckResult {
  desc: string;
  pass: boolean;
  weight: number;
  detail?: string;
}

export interface ScenarioScore {
  /** Whether the payload/missing outcome itself matched what was expected. */
  outcomeOk: boolean;
  /** Weighted fraction of checks that passed, 0..1. */
  score: number;
  results: CheckResult[];
}

const norm = (v: unknown): string => String(v ?? "").trim().toLowerCase();
const digits = (v: unknown): string => String(v ?? "").replace(/\D/g, "");

const resolve = (obj: unknown, path: string): unknown => {
  const segments = path
    .replace(/\[(\w+)\]/g, ".$1")
    .split(".")
    .filter(Boolean);
  let cursor: unknown = obj;
  for (const segment of segments) {
    if (cursor == null) return undefined;
    const index = Number(segment);
    cursor = Array.isArray(cursor) && Number.isInteger(index)
      ? cursor[index]
      : (cursor as Payload)[segment];
  }
  return cursor;
};

const isEmpty = (v: unknown): boolean =>
  v == null || v === "" || (Array.isArray(v) && v.length === 0);

const evalOp = (op: Op, actual: unknown, value: unknown): boolean => {
  switch (op) {
    case "eq":
      return typeof value === "number"
        ? Number(actual) === value
        : norm(actual) === norm(value);
    case "num":
      return Number(actual) === Number(value);
    case "phoneDigits":
      return digits(actual) === digits(value);
    case "iContains":
      return norm(actual).includes(norm(value));
    case "len":
      return Array.isArray(actual) && actual.length === Number(value);
    case "gte": {
      const n = Array.isArray(actual) ? actual.length : Number(actual);
      return n >= Number(value);
    }
    case "oneOf":
      return (
        Array.isArray(value) && value.some((option) => norm(option) === norm(actual))
      );
    case "present":
      return !isEmpty(actual);
    case "absent":
      return isEmpty(actual);
    case "hourUTC": {
      const date = new Date(String(actual));
      return !Number.isNaN(date.getTime()) && date.getUTCHours() === Number(value);
    }
  }
};

const runCheck = (check: Check, payload: Payload): CheckResult => {
  const weight = check.weight ?? 1;
  if (check.fn) {
    return { desc: check.desc, pass: safe(() => check.fn!(payload)), weight };
  }
  const actual = resolve(payload, check.path ?? "");
  const pass = evalOp(check.op ?? "present", actual, check.value);
  return {
    desc: check.desc,
    pass,
    weight,
    detail: pass ? undefined : `got ${JSON.stringify(actual)}`,
  };
};

const safe = (fn: () => boolean): boolean => {
  try {
    return fn();
  } catch {
    return false;
  }
};

export const scoreScenario = (expect: Expect, parse: Parse): ScenarioScore => {
  if (expect.kind === "missing") {
    const reportedMissing = parse.payload === undefined;
    const joined = norm((parse.missing ?? []).join(" | "));
    const results: CheckResult[] = [
      {
        desc: "field reported incomplete (no payload)",
        pass: reportedMissing,
        weight: 2,
        detail: reportedMissing
          ? undefined
          : `got payload ${JSON.stringify(parse.payload)}`,
      },
      ...(expect.mustMention ?? []).map((term) => ({
        desc: `missing note mentions "${term}"`,
        pass: reportedMissing && joined.includes(norm(term)),
        weight: 1,
        detail: reportedMissing ? undefined : "no missing note",
      })),
    ];
    return summarise(results, reportedMissing);
  }

  // expect.kind === "payload"
  if (!parse.payload) {
    return {
      outcomeOk: false,
      score: 0,
      results: [
        {
          desc: "field produced a payload",
          pass: false,
          weight: 2,
          detail: `reported missing: ${JSON.stringify(parse.missing ?? [])}`,
        },
      ],
    };
  }

  const results = expect.checks.map((check) => runCheck(check, parse.payload!));
  return summarise(results, true);
};

const summarise = (results: CheckResult[], outcomeOk: boolean): ScenarioScore => {
  const total = results.reduce((sum, r) => sum + r.weight, 0);
  const passed = results
    .filter((r) => r.pass)
    .reduce((sum, r) => sum + r.weight, 0);
  return { outcomeOk, score: total === 0 ? 1 : passed / total, results };
};
