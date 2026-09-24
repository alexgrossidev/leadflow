import type { NextFunction, Request, Response } from "express";

type Action = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

export abstract class BaseController<TService> {
  constructor(protected readonly service: TService) {}

  /**
   * Wraps an async action so a rejection reaches the error handler instead of
   * becoming an unhandled rejection. The handler logs; this does not, so a
   * failure is logged once.
   */
  protected catchAsync(action: Action) {
    return (req: Request, res: Response, next: NextFunction): void => {
      action(req, res, next).catch(next);
    };
  }

  /** Standard success envelope. */
  protected sendResponse<T>(
    res: Response,
    statusCode: number,
    data: T,
    message?: string,
  ): Response {
    return res.status(statusCode).json({
      success: true,
      statusCode,
      ...(message && { message }),
      data,
    });
  }

  protected ok<T>(res: Response, data: T, message?: string): Response {
    return this.sendResponse(res, 200, data, message);
  }

  protected accepted<T>(res: Response, data: T, message?: string): Response {
    return this.sendResponse(res, 202, data, message);
  }
}
