export abstract class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean = true;
  public readonly title: string;

  constructor(message: string, statusCode: number, title: string = "AppError") {
    super(message);
    this.statusCode = statusCode;
    this.title = title;

    Error.captureStackTrace(this, this.constructor);
  }
}
