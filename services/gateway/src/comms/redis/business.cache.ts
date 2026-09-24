import { cache } from "./cache.js";
import { BusinessRepository } from "../../modules/business/business.repo.js";
import { logger } from "#core/logger";

const CACHE_TTL_SECONDS = 300;
const cacheKey = (userId: number) => `user:${userId}:businessIds`;

const repository = new BusinessRepository();

/**
 * Resolves which businesses a user may act on. Redis is only a cache in front
 * of the database: when it is unavailable we fall back to the source of truth
 * instead of failing open (skipping the check) or failing every request.
 */
export class BusinessContextService {
  static async getBusinessIds(userId: number): Promise<number[]> {
    const key = cacheKey(userId);

    try {
      const cached = await cache.get(key);
      if (cached) return JSON.parse(cached) as number[];
    } catch (err) {
      logger.warn({ err, userId }, "Business cache read failed; using database");
    }

    const businesses = await repository.findAllByUserId(userId);
    const ids = businesses.map((b) => b.id);

    await cache
      .set(key, JSON.stringify(ids), CACHE_TTL_SECONDS)
      .catch((err: unknown) =>
        logger.warn({ err, userId }, "Business cache write failed"),
      );

    return ids;
  }

  /** Call after a user's set of businesses changes (create/delete). */
  static async invalidate(userId: number): Promise<void> {
    await cache.del(cacheKey(userId));
  }
}
