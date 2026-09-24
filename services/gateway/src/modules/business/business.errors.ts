import { ConflictError } from "#core/errors/http-errors";

export class BusinessAlreadyExistsError extends ConflictError {
  constructor() {
    super("Business already exists", "BUSINESS_EXISTS");
  }
}
