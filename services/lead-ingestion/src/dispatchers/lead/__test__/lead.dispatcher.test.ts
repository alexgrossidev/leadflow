import { describe, it, expect, vi } from "vitest";
import {
  LeadCaptureDispatcher,
  type LeadStore,
  type PageTokenLookup,
} from "#dispatchers/lead/lead.dispatcher";
import {
  LeadFatalError,
  LeadRetryableError,
} from "#modules/fbLead/fbLead.errors";
import { ExternalHttpError } from "#core/http/http.errors";
import type { FacebookLead, FacebookLeadData } from "#modules/fbLead/fbLead.table";
import type { FacebookToken } from "#modules/fbToken/fbToken.table";

const PAGE_ID = "page_1";
const LEADGEN_ID = "lg_42";

const graphLead = {
  id: LEADGEN_ID,
  created_time: "2026-07-02T10:00:00+0000",
  field_data: [
    { name: "full_name", values: ["Mario Rossi"] },
    { name: "email", values: ["mario@example.com"] },
  ],
};

const tokenRow = {
  userId: 1001,
  businessId: 2001,
  token: "page-token",
  tokenType: "page",
  fbPageId: PAGE_ID,
} as FacebookToken;

/** In-memory facebook_lead table keyed like the real unique index. */
function memoryLeadStore(initial?: Partial<FacebookLead>) {
  const rows = new Map<string, FacebookLead>();
  const key = (userId: number, leadId: string) => `${userId}:${leadId}`;
  if (initial) {
    const row = {
      id: 1,
      userId: 1001,
      leadId: LEADGEN_ID,
      fetched: false,
      delivered: false,
      rawResponse: {},
      cleanResponse: {},
      createdAt: new Date(),
      updatedAt: new Date(),
      ...initial,
    } as FacebookLead;
    rows.set(key(row.userId, row.leadId), row);
  }
  const store: LeadStore & { rows: typeof rows } = {
    rows,
    getByLeadId: vi.fn(async (userId: number, leadId: string) =>
      rows.get(key(userId, leadId)) ?? null,
    ),
    upsert: vi.fn(async (data: FacebookLeadData) => {
      const existing = rows.get(key(data.userId, data.leadId));
      rows.set(key(data.userId, data.leadId), {
        ...(existing ?? { id: rows.size + 1, createdAt: new Date() }),
        ...data,
        updatedAt: new Date(),
      } as FacebookLead);
    }),
  };
  return store;
}

function setup(opts: {
  initial?: Partial<FacebookLead>;
  token?: FacebookToken | null;
  graph?: () => Promise<unknown>;
} = {}) {
  const leadRepo = memoryLeadStore(opts.initial);
  const tokenRepo: PageTokenLookup = {
    findByFbPageId: vi.fn().mockResolvedValue(
      opts.token === undefined ? tokenRow : opts.token,
    ),
  };
  const getLeadDetails = vi.fn(opts.graph ?? (async () => graphLead));
  const deliver = vi.fn().mockResolvedValue(undefined);
  const dispatcher = new LeadCaptureDispatcher({
    leadRepo,
    tokenRepo,
    api: { getLeadDetails: getLeadDetails as never },
    delivery: { deliver },
    logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } as never,
  });
  return { dispatcher, leadRepo, getLeadDetails, deliver };
}

const input = { leadgenId: LEADGEN_ID, pageId: PAGE_ID };

describe("LeadCaptureDispatcher: resumable FETCH → PARSE → DELIVER", () => {
  it("runs every stage for a new lead and ends delivered", async () => {
    const { dispatcher, leadRepo, getLeadDetails, deliver } = setup();

    await dispatcher.run(input);

    expect(getLeadDetails).toHaveBeenCalledWith(LEADGEN_ID, "page-token");
    expect(deliver).toHaveBeenCalledTimes(1);
    const [lead, ctx] = deliver.mock.calls[0];
    expect(lead).toMatchObject({ leadId: LEADGEN_ID, fullName: "Mario Rossi" });
    expect(ctx).toEqual({ userId: 1001, businessId: 2001, source: "facebook" });
    expect(leadRepo.rows.get(`1001:${LEADGEN_ID}`)?.delivered).toBe(true);
  });

  it("skips FETCH when the row is already fetched", async () => {
    const { dispatcher, getLeadDetails, deliver } = setup({
      initial: { fetched: true, rawResponse: graphLead },
    });

    await dispatcher.run(input);

    expect(getLeadDetails).not.toHaveBeenCalled();
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it("skips PARSE when the row already holds a parsed lead", async () => {
    const parsed = { leadId: LEADGEN_ID, fullName: "Stored Name", customFields: {} };
    const { dispatcher, leadRepo, deliver } = setup({
      initial: { fetched: true, rawResponse: graphLead, cleanResponse: parsed },
    });

    await dispatcher.run(input);

    // The only upsert is the final "delivered" one: no re-parse.
    expect(leadRepo.upsert).toHaveBeenCalledTimes(1);
    expect(deliver.mock.calls[0][0].fullName).toBe("Stored Name");
  });

  it("does nothing for an already delivered lead", async () => {
    const { dispatcher, deliver, getLeadDetails } = setup({
      initial: {
        fetched: true,
        delivered: true,
        rawResponse: graphLead,
        cleanResponse: { leadId: LEADGEN_ID, customFields: {} },
      },
    });

    await dispatcher.run(input);

    expect(getLeadDetails).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
  });

  it("treats an empty Graph response as retryable (eventual consistency)", async () => {
    const { dispatcher, deliver } = setup({ graph: async () => ({}) });
    await expect(dispatcher.run(input)).rejects.toBeInstanceOf(LeadRetryableError);
    expect(deliver).not.toHaveBeenCalled();
  });

  it("fails fatally when no token is stored for the page", async () => {
    const { dispatcher } = setup({ token: null });
    await expect(dispatcher.run(input)).rejects.toBeInstanceOf(LeadFatalError);
  });

  it("retries while a reconnect has the row holding a user token", async () => {
    const { dispatcher, getLeadDetails } = setup({
      token: { ...tokenRow, tokenType: "user" },
    });
    await expect(dispatcher.run(input)).rejects.toBeInstanceOf(LeadRetryableError);
    expect(getLeadDetails).not.toHaveBeenCalled();
  });

  it("classifies a Graph 5xx as retryable", async () => {
    const { dispatcher } = setup({
      graph: async () => {
        throw new ExternalHttpError("Graph", "GET /lg_42", 502, undefined);
      },
    });
    await expect(dispatcher.run(input)).rejects.toBeInstanceOf(LeadRetryableError);
  });

  it("classifies a Graph 4xx as fatal", async () => {
    const { dispatcher } = setup({
      graph: async () => {
        throw new ExternalHttpError("Graph", "GET /lg_42", 400, undefined, {
          code: 100,
          message: "Unsupported get request",
        });
      },
    });
    await expect(dispatcher.run(input)).rejects.toBeInstanceOf(LeadFatalError);
  });

  it("classifies Graph throttling (HTTP 400, code 4) as retryable", async () => {
    const { dispatcher } = setup({
      graph: async () => {
        throw new ExternalHttpError("Graph", "GET /lg_42", 400, undefined, {
          code: 4,
          message: "Application request limit reached",
        });
      },
    });
    await expect(dispatcher.run(input)).rejects.toBeInstanceOf(LeadRetryableError);
  });

  it("resumes after a delivery failure without fetching again", async () => {
    const { dispatcher, getLeadDetails, deliver, leadRepo } = setup();
    deliver.mockRejectedValueOnce(new LeadRetryableError("gateway down"));

    await expect(dispatcher.run(input)).rejects.toBeInstanceOf(LeadRetryableError);
    await dispatcher.run(input);

    expect(getLeadDetails).toHaveBeenCalledTimes(1);
    expect(deliver).toHaveBeenCalledTimes(2);
    expect(leadRepo.rows.get(`1001:${LEADGEN_ID}`)?.delivered).toBe(true);
  });
});
