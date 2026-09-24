# Onboarding parse eval

An offline-scored eval for the onboarding parser. Each scenario is a free-text
message written the way a small-business owner would send it, labeled with the
structured record the parser should produce, or with the fact that it should
report missing information instead of guessing.

The harness runs every scenario through the production parsing path
(`parseField`: the same prompts, `fields.json` schemas, runtime schema
validation and agent loop the service uses), stops before anything is sent to
the gateway, and scores the result deterministically. No LLM is used as a judge.

## Running it

```sh
npm run eval:onboard                          # all scenarios, Anthropic (ANTHROPIC_API_KEY)
npm run eval:onboard -- BI-2 TM-2             # selected ids
npm run eval:onboard -- --field=create_time   # one field
LLM_PROVIDER=gemini npm run eval:onboard      # GEMINI_API_KEY; throttled for free-tier rate limits
LLM_PROVIDER=fake npm run eval:onboard        # offline smoke test of the harness itself
```

| Env | Default | Purpose |
| --- | --- | --- |
| `LLM_PROVIDER` | `anthropic` | `anthropic`, `gemini` or `fake` |
| `ANTHROPIC_MODEL` / `ANTHROPIC_EFFORT` | `claude-opus-5` / onboarding effort | Model under test |
| `GEMINI_MODEL` | `gemini-3.5-flash-lite` | Model under test |
| `EVAL_OUT` | `./eval-results` (git-ignored) | Where run records are written |
| `EVAL_THROTTLE_MS` | 13000 for Gemini, 0 otherwise | Pause between scenarios |
| `EVAL_PARSE_TIMEOUT_MS` | 130000 | Wall clock per scenario |

Transient provider failures (429, 5xx, dropped connections) are retried with
the engine's own retry policy. Anything else is recorded as an error for that
scenario and the run continues.

Each run prints a per-field and per-tag summary plus every failing check, and
writes `run-<timestamp>.json` and `latest.json` with the payload each scenario
produced, so two runs can be diffed after a prompt or schema change.

## Dataset categories

Every scenario carries one or more tags (`dataset.ts`, `ScenarioTag`). The
summary reports a mean score per tag, so a regression in one kind of input is
visible even when the overall score barely moves.

| Tag | What it stresses |
| --- | --- |
| `clean` | Complete, well-formed input. The baseline: failures here are prompt or schema bugs. |
| `misspelled` | Typos, missing accents, lowercase, chat-style spelling (`sabbato`, `chiuzo`, `ciaoo`). |
| `mixed-language` | Italian and English in the same message (`haircut uomo a 15 euro, 30 min`). |
| `prompt-injection` | Text that tries to steer the parser: set ids, zero out prices, invent passwords. The parser must extract the facts and ignore the instruction. |
| `must-report-missing` | A required value is genuinely absent or ambiguous. The correct outcome is `report_missing_info`, never an invented value. |
| `normalisation` | Values that need converting: `un'ora` to 60 minutes, `una settimana` to 7 days, `9 to 5` to 17:00, overnight ranges, `24 ore su 24`. |

Most scenarios are Italian on purpose, since it is the primary customer
language. Every person, business, address and phone number is invented, and
all domains are under `example.com` / `example.it`.

## Scoring

`score.ts` scores one parse against its expectation. It is pure and
unit-tested (`__test__/score.test.ts`).

**Payload scenarios** list checks against the produced record:

- Structured values (enums, numbers, emails, counts, ISO times) are compared
  exactly after light normalisation: trimmed and case-insensitive strings,
  digits-only phone numbers, numeric coercion.
- Free prose (descriptions, message bodies) is only checked for presence; its
  wording is for human review, not grading.
- Path checks (`path` + `op`) cover simple lookups such as `users[0].email`.
  Checks a path cannot express ("Monday's second block opens at 15:00") use a
  small predicate (`fn`); a predicate that throws counts as a failed check.

Each check has a weight (default 1). Keys that matter most, such as the email
that receives the invite, a price, or the `absent` checks that catch a
prompt injection leaking an id into the record, weigh 2 or 3. The scenario
score is passed weight divided by total weight. If the parser reported missing
information where a record was expected, the score is 0.

**Missing-info scenarios** check that no record was produced (weight 2, the
outcome that matters) and that the missing-info note mentions each expected
term (weight 1 each, e.g. `"email"`). Producing a record here scores 0: an
invented value is the failure the category exists to catch.

A scenario is a **PASS** when its outcome is right and every check passes,
**PART** when the outcome is right but some checks fail, and **FAIL** when the
outcome is wrong.

## Adding a scenario

Append to `SCENARIOS` in `dataset.ts` with a unique id (field prefix plus a
number), the field key, locale, tags, a one-line `note` naming the edge case,
the owner's text, and the expectation. Prefer path checks; reach for `fn` only
when the check needs to search an array.
