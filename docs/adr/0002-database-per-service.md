# 0002: A database per service

**Status:** accepted

## Context

The original system grew around one shared schema that several services read and wrote. Changes to one table rippled across services, and nobody owned the invariants: two services wrote to automation targets with different rules.

## Decision

Each service owns its MySQL database and is the only writer and reader of it. Data crosses service boundaries only through events, jobs, gRPC or internal HTTP. Each service ships its schema as ordered SQL migrations in `services/<service>/migrations`, and the demo applies them to an empty database.

## Consequences

- A service's invariants live in one codebase. For example, the automation targets' primary key and pause semantics live entirely in `automations`.
- Services can be deployed and migrated independently.
- **Cost:** data is duplicated where a service needs to react without a round-trip. `lead.created` carries the matchable lead fields, and `automations` keeps its own `contacts` table. Consistency across services is eventual.
- **Cost:** no cross-service joins or foreign keys. Deleting a tenant has to be propagated by events, which is listed as future work.
