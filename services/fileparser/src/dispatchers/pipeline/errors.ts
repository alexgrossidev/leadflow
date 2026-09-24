/**
 * A failure that retrying cannot fix (unsupported file type, file too large,
 * no data rows). The job is failed once and reported, instead of being retried
 * by the queue with the same outcome.
 */
export class PermanentImportError extends Error {
  override readonly name = "PermanentImportError";
}

export class FileTooLargeError extends PermanentImportError {
  constructor(
    readonly sizeBytes: number,
    readonly maxBytes: number,
  ) {
    super(
      `File is ${sizeBytes} bytes; spreadsheet imports are limited to ${maxBytes} bytes`,
    );
  }
}
