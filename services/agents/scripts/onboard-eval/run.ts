/**
 * Onboarding parse eval harness. Runs each labeled scenario through the real
 * parseField pipeline (prompts, fields.json schemas, runtime validation, agent
 * loop) against the selected provider, captures the structured record before
 * any gateway dispatch, scores it against ground truth, and writes a JSON
 * record of the run.
 *
 * A dev tool, not part of the service: it exists to iterate on prompt and
 * schema quality, so it deliberately skips dispatch, the database and HTTP.
 *
 * Usage:
 *   npm run eval:onboard                              # all scenarios, Anthropic
 *   npm run eval:onboard -- BI-2 TM-2                 # only these ids
 *   npm run eval:onboard -- --field=create_time
 *   LLM_PROVIDER=gemini npm run eval:onboard
 *   LLM_PROVIDER=fake npm run eval:onboard            # offline smoke test of the harness
 *
 * Env: LLM_PROVIDER (anthropic|gemini|fake), ANTHROPIC_API_KEY, ANTHROPIC_MODEL,
 * ANTHROPIC_EFFORT, GEMINI_API_KEY, GEMINI_MODEL, EVAL_OUT (default
 * ./eval-results), EVAL_THROTTLE_MS, EVAL_PARSE_TIMEOUT_MS.
 */
import { mkdirSync, writeFileSync } from "fs";
import { resolve } from "path";
import { onboardingConfig } from "#config/onboarding";
import { AgentLoop } from "#core/agent/loop";
import type { TokenUsage } from "#core/agent/llm.port";
import { createLlmProvider, type LlmProviderId } from "#core/agent/providers/index";
import { withRetry } from "#core/agent/retry";
import { logger } from "#core/logger";
import { parseField } from "#dispatchers/onboarding/parse-field";
import { getField } from "#dispatchers/onboarding/registry";
import { SCENARIOS, type Scenario } from "./dataset.js";
import { scoreScenario, type Parse, type ScenarioScore } from "./score.js";

const PROVIDERS = ["anthropic", "gemini", "fake"] as const;
const providerId = (process.env.LLM_PROVIDER ?? "anthropic") as LlmProviderId;
if (!PROVIDERS.includes(providerId)) {
  console.error(`LLM_PROVIDER must be one of ${PROVIDERS.join(", ")}`);
  process.exit(1);
}

const providerEnv = {
  LLM_PROVIDER: providerId,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL ?? "claude-opus-5",
  ANTHROPIC_EFFORT: (process.env.ANTHROPIC_EFFORT ?? onboardingConfig.llm.effort) as
    | "low"
    | "medium"
    | "high"
    | "xhigh"
    | "max",
  ANTHROPIC_REFUSAL_FALLBACK: process.env.ANTHROPIC_REFUSAL_FALLBACK !== "false",
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GEMINI_MODEL: process.env.GEMINI_MODEL ?? "gemini-3.5-flash-lite",
};

const MODEL =
  providerId === "anthropic"
    ? providerEnv.ANTHROPIC_MODEL
    : providerId === "gemini"
      ? providerEnv.GEMINI_MODEL
      : "fake";
const OUT_DIR = resolve(process.env.EVAL_OUT ?? "eval-results");
// Free-tier Gemini caps requests per minute hard; spacing scenarios keeps a
// run under it instead of collapsing into retry stalls.
const THROTTLE_MS = Number(
  process.env.EVAL_THROTTLE_MS ?? (providerId === "gemini" ? 13_000 : 0),
);
/** Per-scenario wall clock; a healthy parse takes seconds. */
const PARSE_TIMEOUT_MS = Number(process.env.EVAL_PARSE_TIMEOUT_MS ?? 130_000);

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface ScenarioRun {
  scenario: Scenario;
  parse: Parse;
  usage: TokenUsage;
  score: ScenarioScore;
  error?: string;
}

/** Retries only what the engine's own policy calls transient (429/5xx/network). */
const runScenario = async (
  loop: AgentLoop,
  scenario: Scenario,
): Promise<{ parse: Parse; usage: TokenUsage }> => {
  const field = getField(scenario.field);
  if (!field) throw new Error(`No registered field "${scenario.field}"`);
  const signal = AbortSignal.timeout(PARSE_TIMEOUT_MS);

  const { value } = await withRetry(
    () => parseField(loop, field, { text: scenario.text, locale: scenario.locale, signal }),
    {
      attempts: 4,
      baseDelayMs: 2_000,
      maxDelayMs: 60_000,
      signal,
      onRetry: (_error, _attempt, delayMs) =>
        process.stdout.write(` (transient, retrying in ${Math.round(delayMs / 1000)}s)`),
    },
  );
  return { parse: { payload: value.payload, missing: value.missing }, usage: value.usage };
};

const selectScenarios = (argv: string[]): Scenario[] => {
  const fieldArg = argv.find((a) => a.startsWith("--field="))?.split("=")[1];
  const ids = argv.filter((a) => !a.startsWith("--"));
  let selected = SCENARIOS;
  if (fieldArg) selected = selected.filter((s) => s.field === fieldArg);
  if (ids.length) selected = selected.filter((s) => ids.includes(s.id));
  return selected;
};

const pct = (n: number): string => `${(n * 100).toFixed(0)}%`;

const mean = (xs: number[]): number =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;

const isFullPass = (run: ScenarioRun): boolean =>
  run.score.outcomeOk && run.score.score === 1;

const main = async () => {
  // Per-tool info logs would interleave with the report; keep warnings only.
  logger.level = process.env.LOG_LEVEL ?? "warn";
  const scenarios = selectScenarios(process.argv.slice(2));
  if (!scenarios.length) {
    console.error("No scenarios matched the filter.");
    process.exit(1);
  }

  const loop = new AgentLoop(createLlmProvider(providerEnv), onboardingConfig.llm);

  console.log(
    `\nOnboarding eval: provider=${providerId} model=${MODEL}, ${scenarios.length} scenarios\n`,
  );
  const runs: ScenarioRun[] = [];
  const totalUsage: TokenUsage = { inputTokens: 0, outputTokens: 0 };

  for (const [index, scenario] of scenarios.entries()) {
    process.stdout.write(`- ${scenario.id.padEnd(6)} ${scenario.field.padEnd(26)}`);
    try {
      const { parse, usage } = await runScenario(loop, scenario);
      const score = scoreScenario(scenario.expect, parse);
      totalUsage.inputTokens += usage.inputTokens;
      totalUsage.outputTokens += usage.outputTokens;
      const run = { scenario, parse, usage, score };
      runs.push(run);
      const flag = isFullPass(run) ? "PASS" : score.outcomeOk ? "PART" : "FAIL";
      console.log(` ${flag}  ${pct(score.score)}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      runs.push({
        scenario,
        parse: {},
        usage: { inputTokens: 0, outputTokens: 0 },
        score: { outcomeOk: false, score: 0, results: [] },
        error: message,
      });
      console.log(` ERROR  ${message.slice(0, 80)}`);
    }
    if (THROTTLE_MS > 0 && index < scenarios.length - 1) await sleep(THROTTLE_MS);
  }

  report(runs, totalUsage);
};

const report = (runs: ScenarioRun[], usage: TokenUsage): void => {
  const overall = mean(runs.map((r) => r.score.score));
  const fullPass = runs.filter(isFullPass).length;

  console.log("\n--- Summary -------------------------------------------------");
  console.log(`Full pass: ${fullPass}/${runs.length}   Mean score: ${pct(overall)}`);
  for (const field of [...new Set(runs.map((r) => r.scenario.field))]) {
    const fieldRuns = runs.filter((r) => r.scenario.field === field);
    console.log(`  ${field.padEnd(26)} ${pct(mean(fieldRuns.map((r) => r.score.score)))}`);
  }
  for (const tag of [...new Set(runs.flatMap((r) => r.scenario.tags))].sort()) {
    const tagged = runs.filter((r) => r.scenario.tags.includes(tag));
    console.log(`  [${tag}]`.padEnd(28) + ` ${pct(mean(tagged.map((r) => r.score.score)))}`);
  }

  console.log("\n--- Failing checks ------------------------------------------");
  if (runs.every(isFullPass)) console.log("  none: every scenario fully passed");
  for (const run of runs) {
    if (isFullPass(run)) continue;
    console.log(`\n  ${run.scenario.id} (${run.scenario.field}): ${run.scenario.note}`);
    if (run.error) {
      console.log(`    ERROR: ${run.error.slice(0, 300)}`);
      continue;
    }
    if (run.parse.missing) console.log(`    reported missing: ${JSON.stringify(run.parse.missing)}`);
    for (const check of run.score.results.filter((c) => !c.pass)) {
      console.log(`    x ${check.desc}${check.detail ? `: ${check.detail}` : ""}`);
    }
  }

  console.log(`\nTokens: in=${usage.inputTokens} out=${usage.outputTokens} (${runs.length} scenarios)`);

  mkdirSync(OUT_DIR, { recursive: true });
  const at = new Date().toISOString();
  const record = {
    provider: providerId,
    model: MODEL,
    at,
    overall,
    fullPass,
    total: runs.length,
    usage,
    runs: runs.map((r) => ({
      id: r.scenario.id,
      field: r.scenario.field,
      locale: r.scenario.locale,
      tags: r.scenario.tags,
      note: r.scenario.note,
      outcomeOk: r.score.outcomeOk,
      score: r.score.score,
      payload: r.parse.payload,
      missing: r.parse.missing,
      failedChecks: r.score.results
        .filter((c) => !c.pass)
        .map((c) => ({ desc: c.desc, detail: c.detail })),
      error: r.error,
    })),
  };
  const jsonPath = resolve(OUT_DIR, `run-${at.replace(/[:.]/g, "-")}.json`);
  writeFileSync(jsonPath, JSON.stringify(record, null, 2));
  writeFileSync(resolve(OUT_DIR, "latest.json"), JSON.stringify(record, null, 2));
  console.log(`\nRecorded: ${jsonPath}`);
};

main().catch((error) => {
  console.error("\n[eval] fatal:", error);
  process.exit(1);
});
