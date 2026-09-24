import { describe, it, expect, vi, beforeEach } from "vitest";
import { CustomerNoteService } from "../cusnotes.service.js";
import type { CustomerNoteRepository } from "../cusnotes.repo.js";
import type { CustomerRepository } from "../../customers/customers.repo.js";
import { NotFoundError } from "#core/errors/http-errors";

const tx = vi.hoisted(() => ({ marker: "tx" }));
vi.mock("#database/mainPool", () => ({
  mainDb: { transaction: vi.fn(async (cb: (t: unknown) => unknown) => cb(tx)) },
}));

const tenant = { userId: 2, businessId: 10 };

describe("CustomerNoteService", () => {
  let notes: {
    listForCustomer: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    softDelete: ReturnType<typeof vi.fn>;
  };
  let customers: { existsInBusiness: ReturnType<typeof vi.fn> };
  let service: CustomerNoteService;

  beforeEach(() => {
    notes = {
      listForCustomer: vi.fn(),
      insert: vi.fn(),
      update: vi.fn(),
      softDelete: vi.fn(),
    };
    customers = { existsInBusiness: vi.fn() };
    service = new CustomerNoteService(
      notes as unknown as CustomerNoteRepository,
      customers as unknown as CustomerRepository,
    );
  });

  describe("create", () => {
    it("writes inside the transaction with tenant ids from the context", async () => {
      customers.existsInBusiness.mockResolvedValue(true);
      notes.insert.mockResolvedValue(7);

      const result = await service.create(tenant, 5, { title: "Call", description: "Follow up" });

      expect(result).toEqual({ id: 7 });
      expect(customers.existsInBusiness).toHaveBeenCalledWith(5, 10, tx);
      expect(notes.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          customerId: 5,
          businessId: 10,
          createdBy: 2,
          title: "Call",
          createdAt: expect.any(Date),
        }),
        tx,
      );
    });

    it("refuses to attach a note to another tenant's customer", async () => {
      customers.existsInBusiness.mockResolvedValue(false);

      await expect(
        service.create(tenant, 99, { title: "x", description: "y" }),
      ).rejects.toBeInstanceOf(NotFoundError);
      expect(notes.insert).not.toHaveBeenCalled();
    });
  });

  describe("update", () => {
    it("updates within the business and customer scope", async () => {
      notes.update.mockResolvedValue(true);
      await expect(service.update(10, 5, 1, { title: "New" })).resolves.toEqual({ id: 1 });
      expect(notes.update).toHaveBeenCalledWith(1, { businessId: 10, customerId: 5 }, { title: "New" });
    });

    it("throws NotFoundError when no active note matched", async () => {
      notes.update.mockResolvedValue(false);
      await expect(service.update(10, 5, 99, { title: "x" })).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("remove", () => {
    it("soft-deletes within scope", async () => {
      notes.softDelete.mockResolvedValue(true);
      await service.remove(10, 5, 1);
      expect(notes.softDelete).toHaveBeenCalledWith(1, { businessId: 10, customerId: 5 });
    });

    it("throws NotFoundError when nothing was deleted", async () => {
      notes.softDelete.mockResolvedValue(false);
      await expect(service.remove(10, 5, 1)).rejects.toBeInstanceOf(NotFoundError);
    });
  });
});
