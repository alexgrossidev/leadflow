import { BadRequestError, NotFoundError } from "#core/errors/http-errors";

export class ObjectNotStoredError extends NotFoundError {
  constructor() {
    super("The uploaded file was not found in storage", "UPLOAD_NOT_FOUND");
  }
}

export class ImportSessionNotFoundError extends NotFoundError {
  constructor() {
    super("Import not found", "IMPORT_NOT_FOUND");
  }
}

export class ImportReportNotSupportedError extends BadRequestError {
  constructor(type: string) {
    super(`Import reporting is not supported for type '${type}' yet`, "IMPORT_REPORT_UNSUPPORTED");
  }
}
