/**
 * Minimal stand-in for the Facebook Graph API, for the local demo.
 *
 *   MOCK_GRAPH_PORT=4010 npx tsx scripts/mock-graph.ts
 *
 * Point the service at it with FB_GRAPH_BASE_URL=http://localhost:4010 (or the
 * container name in docker-compose). It answers only what the lead path and
 * the reconciliation sync call; any access token is accepted.
 */
import Fastify from "fastify";

const PORT = Number(process.env.MOCK_GRAPH_PORT ?? 4010);

const app = Fastify({ logger: { level: "info" } });

// Stable, realistic answers derived from the leadgen id, so repeated fetches of
// the same lead return the same data (as Graph does).
function fakeLead(leadgenId: string) {
  const n = [...leadgenId].reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) % 9000, 7);
  return {
    id: leadgenId,
    created_time: new Date().toISOString().replace("Z", "+0000"),
    field_data: [
      { name: "full_name", values: ["Marco Esposito"] },
      { name: "email", values: [`marco.esposito+${n}@leadflow.example`] },
      { name: "phone_number", values: [`+39 333 555${String(n).padStart(4, "0")}`] },
      { name: "city", values: ["Milano"] },
      { name: "when_would_you_like_to_be_contacted?", values: ["Weekday mornings"] },
    ],
  };
}

type Params = { version: string; id: string };

// Reconciliation sync: no forms and no leads, so the sync pass is a no-op.
app.get<{ Params: Params }>("/:version/:id/leadgen_forms", async () => ({ data: [] }));
app.get<{ Params: Params }>("/:version/:id/leads", async () => ({ data: [] }));

// Subscription check: report our app as subscribed to leadgen.
app.get<{ Params: Params }>("/:version/:id/subscribed_apps", async () => ({
  data: [{ id: process.env.FB_APP_ID ?? "000000000000000", subscribed_fields: ["leadgen"] }],
}));

// Lead fetch: GET /{version}/{leadgen-id}
app.get<{ Params: Params }>("/:version/:id", async (req) => fakeLead(req.params.id));

app.listen({ port: PORT, host: "0.0.0.0" }).catch((err) => {
  console.error(err);
  process.exit(1);
});
