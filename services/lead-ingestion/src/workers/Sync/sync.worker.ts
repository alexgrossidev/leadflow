import { logger } from "#core/logger";
import { queue } from "#core/queue";
import { leadJobId, leadJobOptions } from "#core/jobs";
import { JobNames } from "@leadflow/shared/jobs";
import type { QueueWorker } from "@leadflow/shared/queue";
import {
  getFormLeadIdsSinceAPI,
  getLeadFormIdsAPI,
} from "../../modules_inbound/fbLead/fbLead.api";
import { FacebookTokenRepository } from "../../modules_inbound/fbToken/fbToken.repo";
import { FacebookLeadRepository } from "../../modules_inbound/fbLead/fbLead.repo";
import { needsRefresh } from "../../dispatchers/refresh/refresh.logic";
import { TOKEN_REFRESH_PROCESS } from "../../dispatchers/refresh.PROCESS";

const tokenRepo = new FacebookTokenRepository();
const leadRepo = new FacebookLeadRepository();

// Re-scan margin layered over the persisted cursor: absorbs clock skew and FB's
// eventual consistency so a lead near a window boundary is never missed.
const OVERLAP_MS = 5 * 60 * 1000;
// First-ever run (no cursor yet): backfill the last day rather than nothing.
const DEFAULT_BACKFILL_MS = 24 * 60 * 60 * 1000;
// A lead job retries for ~75s in total; a row idle for longer than this has no
// live job behind it and is safe to re-drive.
const REDRIVE_AFTER_MS = 15 * 60 * 1000;

/**
 * Progressive reconciliation, the redundant safety net behind the webhook, with
 * three guarantees against silent drops:
 *
 *   1. AUTO-HEAL: before pulling, refresh a near-expiry/invalid token inline so
 *      an expired token never silently stalls collection. An unrecoverable
 *      token is dead-lettered and reported; we skip that account this pass.
 *   2. HIGH-WATER MARK: pull leads from the persisted `last_synced_at` cursor
 *      (minus an overlap margin) up to now, advancing the cursor only after a
 *      fully successful pass, so a failed run is re-covered by the next one.
 *   3. RE-DRIVE: re-enqueue leads that were captured but never delivered.
 */
export function startSyncWorker(): QueueWorker {
  return queue.process(JobNames.FACEBOOK_PERIODIC_SYNC, async (job) => {
    const { userId, pageId } = job.data ?? {};
    if (!userId || !pageId) {
      logger.error({ jobId: job.id }, "Periodic sync with malformed payload");
      return;
    }

    let state = await tokenRepo.findByFbPageId(pageId);
    if (!state?.token || state.userId !== userId) {
      // The account was disconnected or re-linked to another page; the
      // scheduler for the new page replaces this one.
      logger.warn({ userId, pageId }, "Periodic sync skipped: page not connected");
      return;
    }
    const { businessId } = state;

    // ── 1. Auto-heal the token before relying on it ───────────────────────────
    if (needsRefresh(state)) {
      const result = await TOKEN_REFRESH_PROCESS({ userId, businessId, pageId });
      if (result === "unrecoverable") {
        logger.warn(
          { userId, businessId },
          "Facebook token unrecoverable; reconnect requested, skipping this sync pass",
        );
        return;
      }
      state = await tokenRepo.findByAccount(userId, businessId);
      if (!state?.token || state.fbPageId !== pageId) return;
    }
    const token = state.token;

    // ── 2. Progressive window from the persisted high-water mark ──────────────
    const now = Date.now();
    const cursor = state.lastSyncedAt
      ? new Date(state.lastSyncedAt).getTime()
      : now - DEFAULT_BACKFILL_MS;
    const sinceUnix = Math.floor((Math.min(cursor, now) - OVERLAP_MS) / 1000);

    const forms = await getLeadFormIdsAPI(pageId, token);
    let enqueued = 0;
    for (const form of forms) {
      const leads = await getFormLeadIdsSinceAPI(form.id, token, sinceUnix);
      for (const lead of leads) {
        // Same id as the webhook's job: a lead seen by both collapses onto one.
        await queue.enqueue(
          JobNames.FACEBOOK_LEAD_PROCESS,
          { leadgenId: lead.id, pageId, formId: form.id },
          leadJobOptions(leadJobId(JobNames.FACEBOOK_LEAD_PROCESS, lead.id)),
        );
        enqueued += 1;
      }
    }

    // ── 3. Re-drive undelivered leads ─────────────────────────────────────────
    // The original `lead_<id>` job is kept in BullMQ's failed/completed set, and
    // adding a job whose id already exists is a silent no-op, so a re-drive
    // needs its own id. Deriving it from the row's updated_at makes it stable
    // while the row makes no progress (repeat passes dedupe, and a failing
    // re-drive is dead-lettered once rather than hammered every 10 minutes)
    // and fresh once the row moves on.
    const undelivered = await leadRepo.findUndelivered(
      userId,
      new Date(now - REDRIVE_AFTER_MS),
    );
    for (const row of undelivered) {
      const base = leadJobId(JobNames.FACEBOOK_LEAD_PROCESS, row.leadId);
      await queue.enqueue(
        JobNames.FACEBOOK_LEAD_PROCESS,
        { leadgenId: row.leadId, pageId },
        leadJobOptions(`${base}_redrive_${new Date(row.updatedAt).getTime()}`),
      );
    }

    // Advance the cursor only after a fully successful pass; a throw above
    // leaves it untouched so the next run re-covers this window.
    await tokenRepo.touchLastSynced(userId, businessId, new Date(now));

    logger.info(
      {
        jobId: job.id,
        forms: forms.length,
        enqueued,
        redriven: undelivered.length,
        since: sinceUnix,
      },
      "Periodic sync completed",
    );
  });
}
