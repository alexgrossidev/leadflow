import { z } from "zod";

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

/**
 * Shared page/limit guardrails; extend it for module-specific query schemas.
 * Inputs are coerced because pagination almost always arrives as query strings.
 */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce
    .number()
    .int()
    .positive()
    .max(MAX_PAGE_SIZE)
    .default(DEFAULT_PAGE_SIZE),
});

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export interface Bounds {
  limit: number;
  offset: number;
}

export interface PaginationMeta {
  totalCount: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface PaginatedResult<T> {
  data: T[];
  metadata: PaginationMeta;
}

/** Translate a page/limit window into SQL LIMIT/OFFSET bounds. */
export const getBounds = ({ page, limit }: PaginationQuery): Bounds => ({
  limit,
  offset: (page - 1) * limit,
});

/** Wrap a fetched page of rows in the standard paginated envelope. */
export const paginate = <T>(
  data: T[],
  totalCount: number,
  { page, limit }: PaginationQuery,
): PaginatedResult<T> => ({
  data,
  metadata: {
    totalCount,
    page,
    limit,
    totalPages: Math.ceil(totalCount / limit),
  },
});
