/**
 * Demo driver: sends signed webhooks to a running lead-ingestion instance.
 *
 *   npx tsx scripts/simulate-webhooks.ts
 *
 * Env (read from the process, or from ./.env when present):
 *   INGESTION_URL        base URL of the service (default http://localhost:5097)
 *   GOOGLE_FORMS_SECRET  must match the service's GOOGLE_FORMS_SECRET
 *   FB_APP_SECRET        must match the service's FB_APP_SECRET
 *   FB_PAGE_ID           page id seeded in facebook_token (scripts/demo-seed.sql)
 *   DEMO_USER_ID / DEMO_BUSINESS_ID   tenant for the Google lead (default 1 / 1)
 *   GOOGLE_HONEYPOT_FIELD             honeypot label (default website_confirm)
 *
 * Sends, in order:
 *   (a) a correctly signed Google Forms lead            → 200, one job enqueued
 *   (b) the exact same submission again                 → 200, dropped as duplicate
 *   (c) a spam submission (honeypot + link stuffing)    → 200, dropped at the edge
 *   (d) a signed Meta leadgen webhook                   → 200, one job enqueued
 * Drops are silent by design (a bot must not learn which check caught it), so
 * look for "dropped at edge" in the service logs to see (b) and (c).
 */
import crypto from "node:crypto";
import { existsSync } from "node:fs";

if (existsSync(".env")) process.loadEnvFile(".env");

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name}; set it in the environment or in .env`);
    process.exit(1);
  }
  return value;
}

const BASE_URL = (process.env.INGESTION_URL ?? "http://localhost:5097").replace(/\/+$/, "");
const GOOGLE_SECRET = required("GOOGLE_FORMS_SECRET");
const FB_APP_SECRET = required("FB_APP_SECRET");
const FB_PAGE_ID = required("FB_PAGE_ID");
const USER_ID = Number(process.env.DEMO_USER_ID ?? 1);
const BUSINESS_ID = Number(process.env.DEMO_BUSINESS_ID ?? 1);
const HONEYPOT = process.env.GOOGLE_HONEYPOT_FIELD ?? "website_confirm";

const hmac = (secret: string, body: string) =>
  "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");

async function send(
  label: string,
  path: string,
  body: unknown,
  signatureHeader: string,
  secret: string,
  expectation: string,
): Promise<void> {
  const raw = JSON.stringify(body);
  const res = await fetch(`${BASE_URL}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [signatureHeader]: hmac(secret, raw),
    },
    body: raw,
  });
  const text = await res.text();
  console.log(`\n── ${label}`);
  console.log(`POST ${path}`);
  console.log(JSON.stringify(body, null, 2));
  console.log(`→ ${res.status} ${text || "(empty body)"}`);
  console.log(`  expected: ${expectation}`);
}

async function main(): Promise<void> {
  const runId = Date.now();
  const googleLead = {
    userId: USER_ID,
    businessId: BUSINESS_ID,
    formId: "demo_form",
    responseId: `demo_resp_${runId}`,
    createdTime: Date.now(),
    answers: [
      { name: "First name", values: ["Giulia"] },
      { name: "Last name", values: ["Bianchi"] },
      { name: "Email", values: ["giulia.bianchi@leadflow.example"] },
      { name: "Phone", values: ["+39 333 1234567"] },
      { name: "Which plan are you interested in?", values: ["Pro"] },
    ],
  };

  await send(
    "(a) Google Forms lead",
    "/google/capture",
    googleLead,
    "x-leadflow-signature",
    GOOGLE_SECRET,
    "200; job glead_<responseId> enqueued, delivered to the gateway",
  );

  await send(
    "(b) Same Google submission again",
    "/google/capture",
    googleLead,
    "x-leadflow-signature",
    GOOGLE_SECRET,
    "200; dropped as duplicate, no new job",
  );

  await send(
    "(c) Spam submission",
    "/google/capture",
    {
      ...googleLead,
      responseId: `demo_spam_${runId}`,
      answers: [
        { name: "Email", values: ["bot@mailinator.com"] },
        { name: "Message", values: ["http://a.example http://b.example http://c.example"] },
        { name: HONEYPOT, values: ["http://spam.example"] },
      ],
    },
    "x-leadflow-signature",
    GOOGLE_SECRET,
    "200; dropped at the edge (honeypot / content), no job",
  );

  await send(
    "(d) Meta leadgen webhook",
    "/fb/capture",
    {
      object: "page",
      entry: [
        {
          id: FB_PAGE_ID,
          time: Math.floor(runId / 1000),
          changes: [
            {
              field: "leadgen",
              value: {
                leadgen_id: `demo_lg_${runId}`,
                page_id: FB_PAGE_ID,
                form_id: "demo_fb_form",
                created_time: Math.floor(runId / 1000),
              },
            },
          ],
        },
      ],
    },
    "x-hub-signature-256",
    FB_APP_SECRET,
    "200; job lead_<leadgenId> enqueued, fetched from FB_GRAPH_BASE_URL, delivered",
  );
}

main().catch((err) => {
  console.error("Simulation failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
