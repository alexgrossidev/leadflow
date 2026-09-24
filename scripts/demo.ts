/**
 * End-to-end demo against the docker-compose stack (`docker compose up --build`).
 *
 *   npm run demo
 *
 * 1. Connects the demo tenant's WhatsApp session (fake transport, scripted QR login).
 * 2. Logs in as the demo user and creates an automation through the public API:
 *    "every lead with an email gets a welcome email, then a WhatsApp follow-up".
 *    Creating it backfills the leads that already match (gateway → gRPC stream → automations).
 * 3. Fires signed Google Forms + Meta lead webhooks at lead-ingestion, including a
 *    duplicate and a spam submission — new leads flow through `lead.created`.
 * 4. Waits for the sender to deliver, then prints what landed in the Mailpit inbox
 *    and on the fake WhatsApp transport.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const GATEWAY = "http://localhost:3000";
const WHATSAPP = "http://localhost:3012";
const MAILPIT = "http://localhost:8025";
const FAKE_WA = "http://localhost:21465";
const DEMO = { businessId: 1, userId: 1, username: "demo", password: "demo-password" };
const DELIVERY_TIMEOUT_MS = 180_000;

function loadDotEnv(path = ".env"): Record<string, string> {
  try {
    return Object.fromEntries(
      readFileSync(path, "utf8")
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#") && line.includes("="))
        .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
    );
  } catch {
    return {};
  }
}

const env = { ...loadDotEnv(), ...process.env } as Record<string, string>;
const SERVICE_TOKEN = env.SERVICE_TOKEN ?? "demo-service-token-change-me-0123456789";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function http<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers ?? {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? "GET"} ${url} → ${res.status} ${text}`);
  return (text ? JSON.parse(text) : undefined) as T;
}

async function waitFor<T>(label: string, probe: () => Promise<T | undefined>, timeoutMs = 60_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await probe().catch(() => undefined);
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await sleep(1_000);
  }
}

function step(title: string) {
  console.log(`\n▸ ${title}`);
}

async function main() {
  step("Waiting for the stack");
  await waitFor("gateway", async () => ((await fetch(`${GATEWAY}/health`)).ok ? true : undefined));
  await waitFor("whatsapp", async () => ((await fetch(`${WHATSAPP}/health`)).ok ? true : undefined));

  step("Connecting the demo WhatsApp session (fake transport plays the QR login)");
  const sessionUrl = `${WHATSAPP}/sessions/${DEMO.businessId}/${DEMO.userId}`;
  const serviceHeaders = { "x-service-token": SERVICE_TOKEN };
  await http(sessionUrl, { method: "POST", headers: serviceHeaders }).catch((err: Error) => {
    if (!/SESSION_ALREADY|409/.test(err.message)) throw err;
  });
  await waitFor("session connected", async () => {
    const { status } = await http<{ status: string }>(`${sessionUrl}/status`, { headers: serviceHeaders });
    return status === "connected" ? status : undefined;
  });
  console.log("  session connected");

  step("Logging in as the demo user");
  const login = await http<{ data: { accessToken: string } }>(`${GATEWAY}/auth/login`, {
    method: "POST",
    body: JSON.stringify({ username: DEMO.username, password: DEMO.password }),
  });
  const auth = { authorization: `Bearer ${login.data.accessToken}` };

  step("Creating an automation: welcome email, then a WhatsApp follow-up");
  const automation = await http<{ data: { id: number } }>(
    `${GATEWAY}/businesses/${DEMO.businessId}/automations`,
    {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        name: "Welcome new leads",
        automationType: "lead",
        field: "email",
        operator: "is_set",
        value: null,
        steps: [
          {
            stepType: "email",
            step_sequence: 1,
            subject: "Thanks for getting in touch",
            content: "Hi! Thanks for your interest — we'll call you within one working day.",
            delay: 0,
            delay_unit: "minute",
          },
          {
            stepType: "whatsapp",
            step_sequence: 2,
            content: "Hi, it's Demo Studio. Would you like to book a free consultation?",
            delay: 1,
            delay_unit: "minute",
          },
        ],
      }),
    },
  );
  console.log(`  automation #${automation.data.id} created — existing matching leads are backfilled over gRPC`);

  step("Firing lead webhooks at lead-ingestion (Google Forms + Meta, incl. a duplicate and spam)");
  const sim = spawnSync("npx", ["tsx", "services/lead-ingestion/scripts/simulate-webhooks.ts"], {
    stdio: "inherit",
    env: { ...env, INGESTION_URL: "http://localhost:5097", DEMO_USER_ID: "1", DEMO_BUSINESS_ID: "1" },
  });
  if (sim.status !== 0) throw new Error("webhook simulator failed");

  step(`Waiting for delivery (human-like pacing — up to ${DELIVERY_TIMEOUT_MS / 60_000} min)`);
  // Delivery is paced like a human sender, so stop once both channels have been
  // quiet for a while after the first messages arrived (or the timeout hits).
  const deadline = Date.now() + DELIVERY_TIMEOUT_MS;
  let emails: { To: { Address: string }[]; Subject: string }[] = [];
  let whatsapps: { phone: string; message: string }[] = [];
  let lastChange = Date.now();
  let lastCount = 0;
  while (Date.now() < deadline) {
    emails = (await http<{ messages: typeof emails }>(`${MAILPIT}/api/v1/messages`)).messages;
    whatsapps = await http<typeof whatsapps>(`${FAKE_WA}/__messages`);
    process.stdout.write(`\r  emails: ${emails.length}  whatsapp: ${whatsapps.length}   `);
    const count = emails.length + whatsapps.length;
    if (count !== lastCount) [lastCount, lastChange] = [count, Date.now()];
    if (emails.length > 0 && whatsapps.length > 0 && Date.now() - lastChange > 30_000) break;
    await sleep(3_000);
  }
  console.log();

  step("Delivered");
  for (const m of emails) console.log(`  ✉  ${m.To.map((t) => t.Address).join(", ")} — ${m.Subject}`);
  for (const m of whatsapps) console.log(`  💬 ${m.phone} — ${m.message.slice(0, 60)}`);
  console.log(`\nInbox: ${MAILPIT}   ·   WhatsApp log: ${FAKE_WA}/__messages`);
}

main().catch((err: unknown) => {
  console.error(`\n✗ ${(err as Error).message}`);
  process.exit(1);
});
