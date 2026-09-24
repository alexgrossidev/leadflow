# 0006: Human-like, stateless send pacing

**Status:** accepted

## Context

Automated messages go out from a business's own WhatsApp number and mailbox. Bursts of identical messages at machine speed get numbers flagged and mail throttled, so the sender has to behave like a person working through a list: respect opening hours, daily caps, a minimum gap, and irregular pauses.

The original implementation modelled this as a persisted per-user state machine, but it never actually persisted state. It also had a bug that made its delay always positive, so no message was ever delivered.

## Decision

Pacing is **stateless per message** and deterministic:

- Each user has a fixed behaviour profile (speed, burstiness, break tendency) seeded from the user id.
- A Markov-style state choice (focused, normal, distracted, idle) and a Gaussian delay are drawn from a random generator seeded by (user, last send time), then scaled by time of day and by fatigue. Fatigue comes from today's persisted send count.
- The dead-time step computes a "not before" instant: last send + minimum gap + human delay. It succeeds once that instant has passed, and otherwise delays exactly until it.
- Opening hours support split shifts and closed days per business timezone, using only `Intl`, and are correct across DST changes.
- `DELIVER` re-checks limits and pacing immediately before sending, because several messages can pass the limits stage together.

## Consequences

- There is no state to corrupt or migrate, and the same inputs always give the same schedule, so pacing is fully unit- and property-tested.
- **Cost:** strict caps and pacing assume a single `sender.process` worker. With several replicas they become soft limits; a Redis token bucket per user would make them strict.
