import { logger } from "#core/logger";
import { NotFoundError } from "#core/errors/http-errors";
import { isDuplicateKeyError } from "#database/mainPool";
import { BusinessRepository } from "./business.repo.js";
import { Business } from "./business.table.js";
import { BusinessAlreadyExistsError } from "./business.errors.js";
import { CreateBusinessInput, UpdateBusinessInput } from "./business.schema.js";
import { BusinessContextService } from "#comms/redis/business.cache";

export class BusinessService {
  constructor(private readonly repository: BusinessRepository) {}

  async createBusiness(userId: number, data: CreateBusinessInput): Promise<number> {
    let insertId: number;
    try {
      insertId = await this.repository.create({ ...data, userId });
    } catch (error) {
      if (isDuplicateKeyError(error)) throw new BusinessAlreadyExistsError();
      throw error;
    }
    logger.info({ businessId: insertId, userId }, "Business created");
    await this.invalidateAccessCache(userId);
    return insertId;
  }

  async getBusinessesForUser(userId: number): Promise<Business[]> {
    return this.repository.findAllByUserId(userId);
  }

  async getBusiness(businessId: number, userId: number): Promise<Business> {
    const business = await this.repository.findOwned(businessId, userId);
    if (!business) throw new NotFoundError("Business not found");
    return business;
  }

  async editBusiness(
    businessId: number,
    userId: number,
    payload: UpdateBusinessInput,
  ): Promise<Business> {
    const updated = await this.repository.updateOwned(businessId, userId, payload);
    if (!updated) throw new NotFoundError("Business not found");
    return updated;
  }

  async deleteBusiness(businessId: number, userId: number): Promise<void> {
    const removed = await this.repository.deleteOwned(businessId, userId);
    if (removed === 0) throw new NotFoundError("Business not found");
    await this.invalidateAccessCache(userId);
  }

  /**
   * The access cache lives 5 minutes; a failed invalidation only delays access
   * to a new business (or revocation of a deleted one) until it expires.
   */
  private async invalidateAccessCache(userId: number): Promise<void> {
    await BusinessContextService.invalidate(userId).catch((err: unknown) => {
      logger.error({ err, userId }, "Failed to invalidate business access cache");
    });
  }
}
