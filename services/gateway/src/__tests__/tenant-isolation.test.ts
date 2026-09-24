import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { signAccessToken } from "#core/auth/tokens";

const mocks = vi.hoisted(() => ({
  getBusinessIds: vi.fn(),
  create: vi.fn(),
  search: vi.fn(),
}));

vi.mock("#comms/redis/business.cache", () => ({
  BusinessContextService: { getBusinessIds: mocks.getBusinessIds, invalidate: vi.fn() },
}));

vi.mock("../modules/customers/customer.service.js", () => ({
  CustomerService: class {
    create = mocks.create;
    search = mocks.search;
  },
}));

const { createApp } = await import("../app.js");

const USER_ID = 5;
const OWN_BUSINESS = 7;
const OTHER_BUSINESS = 8;

describe("tenant isolation", () => {
  const app = createApp();
  const auth = `Bearer ${signAccessToken(USER_ID)}`;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getBusinessIds.mockResolvedValue([OWN_BUSINESS]);
    mocks.create.mockResolvedValue({ id: 1, fields: [] });
    mocks.search.mockResolvedValue({ customers: [], metadata: {} });
  });

  it("requires an access token for business routes", async () => {
    const res = await request(app).get(`/businesses/${OWN_BUSINESS}/customers`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("TOKEN_MISSING");
  });

  it("rejects a token signed with another secret", async () => {
    const res = await request(app)
      .get(`/businesses/${OWN_BUSINESS}/customers`)
      .set("Authorization", "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiI1In0.c2lnbmF0dXJl");
    expect(res.status).toBe(401);
  });

  it("forbids access to a business the user does not own", async () => {
    const res = await request(app)
      .get(`/businesses/${OTHER_BUSINESS}/customers`)
      .set("Authorization", auth);

    expect(res.status).toBe(403);
    expect(mocks.getBusinessIds).toHaveBeenCalledWith(USER_ID);
    expect(mocks.search).not.toHaveBeenCalled();
  });

  it("fails closed on a malformed business id", async () => {
    const res = await request(app).get("/businesses/abc/customers").set("Authorization", auth);
    expect(res.status).toBe(403);
    expect(mocks.getBusinessIds).not.toHaveBeenCalled();
  });

  it("serves the user's own business", async () => {
    const res = await request(app)
      .get(`/businesses/${OWN_BUSINESS}/customers`)
      .set("Authorization", auth);

    expect(res.status).toBe(200);
    expect(mocks.search).toHaveBeenCalledWith(OWN_BUSINESS, expect.any(Object));
  });

  it("ignores tenant ids supplied in the request body", async () => {
    const res = await request(app)
      .post(`/businesses/${OWN_BUSINESS}/customers`)
      .set("Authorization", auth)
      .send({
        businessId: OTHER_BUSINESS,
        userId: 999,
        customer: { name: "Mallory", email: "m@example.com", businessId: OTHER_BUSINESS },
        customFields: [],
      });

    expect(res.status).toBe(201);
    const [tenant, payload] = mocks.create.mock.calls[0]!;
    expect(tenant).toEqual({ userId: USER_ID, businessId: OWN_BUSINESS });
    expect(payload).not.toHaveProperty("businessId");
    expect(payload).not.toHaveProperty("userId");
    expect(payload.customer).not.toHaveProperty("businessId");
  });

  it("does not expose the removed debug endpoints", async () => {
    expect((await request(app).get("/health/debug/cookies")).status).toBe(401);
    expect((await request(app).get("/health")).status).toBe(200);
  });
});
