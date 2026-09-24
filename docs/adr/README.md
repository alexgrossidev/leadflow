# Architecture decision records

Short records of the decisions that shape this codebase: the context, the choice, and what it costs.

| # | Decision |
|---|---|
| [0001](0001-bullmq-over-kafka.md) | BullMQ on Redis for jobs and events, not Kafka |
| [0002](0002-database-per-service.md) | A database per service |
| [0003](0003-grpc-for-bulk-data.md) | gRPC streams for bulk data, events for facts |
| [0004](0004-idempotency-and-retries.md) | Idempotency keys and retry classification at every hop |
| [0005](0005-own-agent-loop.md) | Own the agent loop behind a single-shot LLM port |
| [0006](0006-human-like-send-pacing.md) | Human-like, stateless send pacing |
