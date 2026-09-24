import { db } from "#core/db";
import { sendingErrors, type NewSendingError } from "./sendingErrors.table";

export class SendingErrorRepository {
  async record(entry: NewSendingError): Promise<void> {
    await db.insert(sendingErrors).values({ ...entry, error: entry.error.slice(0, 255) });
  }
}
