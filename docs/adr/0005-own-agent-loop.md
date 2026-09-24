# 0005: Own the agent loop behind a single-shot LLM port

**Status:** accepted

## Context

The agents service drives tool-using conversations: a receptionist that replies to customers, and a parser that turns onboarding answers into records. It must support more than one model vendor, enforce budgets, and never message a customer twice. Vendor SDKs offer their own tool runners, which execute tools and loop on your behalf.

## Decision

The vendor seam is a **single-shot** port, `LlmProvider.complete(ChatRequest) → AssistantTurn` ([`llm.port.ts`](../../services/agents/src/core/agent/llm.port.ts)), with one adapter per vendor. The loop ([`loop.ts`](../../services/agents/src/core/agent/loop.ts)) is ours:

- tool dispatch;
- runtime schema validation of every tool call, even on vendors without strict tool schemas;
- per-run call caps and terminal tools;
- token and wall-clock budgets;
- usage accounting;
- side-effect tracking (`mutated`).

A vendor's tool runner *is* that vendor's agent loop, so it can't sit behind a vendor-neutral seam.

Retry policy ([`retry.ts`](../../services/agents/src/core/agent/retry.ts)): a run is retried only if the failure is **transient** (rate limit, overload, 5xx, network) **and** no side-effecting tool has succeeded. Retrying a mutated run would message the customer again. Anything unrecognised is final, so a new failure mode shows up as one failed run instead of a burned budget.

## Consequences

- Every vendor gets identical semantics, and adding one means one adapter. A deterministic fake provider makes the loop fully testable and lets the demo run without keys.
- Safety doesn't depend on the model: tenant capabilities decide which tools are offered, identity fields are bound from the trigger rather than the model's arguments, and untrusted text is fenced in the user turn, never in the system prompt.
- **Cost:** we own roughly 250 lines of loop that a vendor would otherwise maintain, and we adopt new vendor features (such as streaming tool input) by hand.
