/**
 * Thrown for input that can never succeed (a malformed payload). BullMQ fails
 * a job without further attempts when the error's name is "UnrecoverableError"
 * (it checks the name, not the class), so services can signal this without
 * depending on BullMQ directly.
 */
export class UnrecoverableJobError extends Error {
  override readonly name = "UnrecoverableError";
}
