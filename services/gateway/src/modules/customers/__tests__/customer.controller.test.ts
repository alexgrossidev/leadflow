import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";
import { CustomerController } from "../customer.controller.js";
import type { CustomerService } from "../customer.service.js";
import { BadRequestError, NotFoundError } from "#core/errors/http-errors";

const makeRes = () => {
  const res: Partial<Response> = {};
  res.status = vi.fn(() => res as Response);
  res.json = vi.fn(() => res as Response);
  return res as Response;
};

const makeReq = (overrides: Partial<Request> = {}) =>
  ({
    params: { customerId: "5" },
    query: {},
    tenant: { userId: 2, businessId: 10 },
    ...overrides,
  }) as unknown as Request;

describe("CustomerController", () => {
  let service: { getCustomer: ReturnType<typeof vi.fn>; search: ReturnType<typeof vi.fn> };
  let controller: CustomerController;

  beforeEach(() => {
    service = { getCustomer: vi.fn(), search: vi.fn() };
    controller = new CustomerController(service as unknown as CustomerService);
  });

  it("propagates domain errors to the global handler instead of answering locally", async () => {
    service.getCustomer.mockRejectedValue(new NotFoundError("Customer missing"));
    const res = makeRes();

    await expect(controller.get(makeReq(), res)).rejects.toBeInstanceOf(NotFoundError);
    expect(res.json).not.toHaveBeenCalled();
  });

  it("reads the business from the tenant context and returns the envelope", async () => {
    const customer = { id: 5, name: "Acme" };
    service.getCustomer.mockResolvedValue(customer);
    const res = makeRes();

    await controller.get(makeReq(), res);

    expect(service.getCustomer).toHaveBeenCalledWith(5, 10);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ success: true, data: customer });
  });

  it("answers 400 for malformed eavFilters JSON instead of crashing", async () => {
    const req = makeReq({ query: { eavFilters: "{not json" } } as Partial<Request>);
    await expect(controller.search(req, makeRes())).rejects.toBeInstanceOf(BadRequestError);
    expect(service.search).not.toHaveBeenCalled();
  });
});
