# 0004: Idempotency keys and retry classification at every hop

**Status:** accepted

## Context

Every transport here delivers **at least once**:

- Meta and Google retry webhooks.
- BullMQ redelivers stalled jobs.
- HTTP callers retry on timeouts.

Sending a customer the same WhatsApp message twice, or creating a lead twice, is the failure users notice.

## Decision

1. **Every handler is idempotent**, keyed on a natural identifier:
   - Leads: `(business, source, external_id)`.
   - Messages: automation, recipient and a hash of the content.
   - Import rows: a hash of the row.

   Job ids are derived from the same keys, so a duplicate enqueue is a no-op.
2. **Errors are classified once, at the boundary**, as *retryable* (connection errors, 5xx, 408, 429, gRPC `UNAVAILABLE`, Meta's throttling codes sent as HTTP 400) or *fatal* (everything else). Only retryable errors are retried, with exponential backoff and jitter, and every retry is bounded.
3. **Where a side effect can't be undone, record it before continuing.** Lead delivery claims a row before calling the gateway, and keeps the claim if the call succeeded but bookkeeping failed. The sender writes a delivery ledger. The agent loop marks a run `mutated` once a side-effecting tool succeeds, and never retries a mutated run.
4. **Exhausted retries end in a dead-letter record** that keeps the original cause. Nothing fails silently.

## Consequences

- A replayed webhook, job or request is safe by construction, and there is a test for each such path.
- **Cost:** a few "at-least-once edges" remain where the side effect and its record can't share a transaction, such as SMTP delivery followed by the ledger write. They are documented rather than hidden.
- **Cost:** content-hash keys mean an identical message to the same recipient from the same automation is sent once, even if intended twice. That is the desired behaviour here.
