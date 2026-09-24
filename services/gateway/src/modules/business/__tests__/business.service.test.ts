import { describe, it, expect, vi, beforeEach } from "vitest";
import { BusinessService } from "../business.service.js";
import type { BusinessRepository } from "../business.repo.js";
import { BusinessAlreadyExistsError } from "../business.errors.js";
import { NotFoundError } from "#core/errors/http-errors";
import type { CreateBusinessInput } from "../business.schema.js";

const invalidate = vi.hoisted(() => vi.fn());
vi.mock("#comms/redis/business.cache", () => ({
  BusinessContextService: { invalidate },
}));

const input = { name: "Acme Corp" } as CreateBusinessInput;
const business = { id: 1, userId: 10, name: "Acme Corp" };

function makeRepo() {
  return {
    create: vi.fn(),
    findAllByUserId: vi.fn(),
    findOwned: vi.fn(),
    updateOwned: vi.fn(),
    deleteOwned: vi.fn(),
  };
}

describe("BusinessService", () => {
  let repo: ReturnType<typeof makeRepo>;
  let service: BusinessService;

  beforeEach(() => {
    vi.clearAllMocks();
    invalidate.mockResolvedValue(undefined);
    repo = makeRepo();
    service = new BusinessService(repo as unknown as BusinessRepository);
  });

  describe("createBusiness", () => {
    it("assigns the authenticated owner and invalidates the access cache", async () => {
      repo.create.mockResolvedValue(42);

      await expect(service.createBusiness(10, input)).resolves.toBe(42);
      expect(repo.create).toHaveBeenCalledWith({ name: "Acme Corp", userId: 10 });
      expect(invalidate).toHaveBeenCalledWith(10);
    });

    it("maps a duplicate key (also when wrapped by drizzle) to BusinessAlreadyExistsError", async () => {
      const driverError = Object.assign(new Error("dup"), { code: "ER_DUP_ENTRY" });
      repo.create.mockRejectedValue(Object.assign(new Error("query failed"), { cause: driverError }));

      await expect(service.createBusiness(10, input)).rejects.toBeInstanceOf(
        BusinessAlreadyExistsError,
      );
    });

    it("rethrows unknown errors", async () => {
      const boom = new Error("db gone");
      repo.create.mockRejectedValue(boom);
      await expect(service.createBusiness(10, input)).rejects.toBe(boom);
    });

    it("still succeeds when cache invalidation fails", async () => {
      repo.create.mockResolvedValue(7);
      invalidate.mockRejectedValue(new Error("redis down"));
      await expect(service.createBusiness(5, input)).resolves.toBe(7);
    });
  });

  describe("getBusiness", () => {
    it("returns the business owned by the user", async () => {
      repo.findOwned.mockResolvedValue(business);
      await expect(service.getBusiness(1, 10)).resolves.toBe(business);
      expect(repo.findOwned).toHaveBeenCalledWith(1, 10);
    });

    it("throws NotFoundError when the user does not own it", async () => {
      repo.findOwned.mockResolvedValue(null);
      await expect(service.getBusiness(1, 999)).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("editBusiness", () => {
    it("updates only within the owner's scope", async () => {
      const updated = { ...business, name: "New Name" };
      repo.updateOwned.mockResolvedValue(updated);

      await expect(service.editBusiness(1, 10, { name: "New Name" })).resolves.toBe(updated);
      expect(repo.updateOwned).toHaveBeenCalledWith(1, 10, { name: "New Name" });
    });

    it("throws NotFoundError when nothing matched", async () => {
      repo.updateOwned.mockResolvedValue(null);
      await expect(service.editBusiness(1, 10, {})).rejects.toBeInstanceOf(NotFoundError);
    });
  });

  describe("deleteBusiness", () => {
    it("deletes and invalidates the access cache", async () => {
      repo.deleteOwned.mockResolvedValue(1);
      await service.deleteBusiness(1, 10);
      expect(repo.deleteOwned).toHaveBeenCalledWith(1, 10);
      expect(invalidate).toHaveBeenCalledWith(10);
    });

    it("throws NotFoundError when no row was removed", async () => {
      repo.deleteOwned.mockResolvedValue(0);
      await expect(service.deleteBusiness(999, 10)).rejects.toBeInstanceOf(NotFoundError);
      expect(invalidate).not.toHaveBeenCalled();
    });
  });
});
