# 0001: BullMQ on Redis for jobs and events, not Kafka

**Status:** accepted

## Context

The system needs durable background work with **per-job delays** (send this in 3 days, retry in 10 minutes), retries with backoff, deduplication by id, and scheduled jobs. It also needs service-to-service notifications ("a lead was created"). Volume is modest: thousands of messages a day per tenant, not millions per second. The team is small, so every piece of infrastructure has to justify its operational cost.

## Decision

Use BullMQ on Redis for both job queues and the event bus, behind a `QueueProvider` interface in `packages/shared`. Jobs get one queue per job name; events get one queue per consuming service, with the event name carried as the job name.

## Consequences

- Delays, retries, backoff, dedupe by job id and cron-like schedulers come built in. With Kafka each would be a custom build: delayed delivery in particular needs extra topics or an external scheduler.
- Redis is already required for locks, rate limits and caches, so there is no new infrastructure.
- **Cost:** no replayable log. An event consumed is gone, so a new service can't rebuild state from history, and there is no fan-out to consumers added later without a producer change. Acceptable today; if the system needs event sourcing or many independent consumers, the provider interface is the seam where a log-based transport would go.
- **Cost:** Redis durability depends on its persistence settings (AOF). Production needs `appendonly yes` and a managed or replicated Redis.
