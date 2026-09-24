import { and, eq } from "drizzle-orm";
import { db } from "../../core/db";
import { contacts, type Contact } from "./contact.table";

export class ContactRepository {
  async get(originalId: number, type: "lead" | "customer", businessId: number): Promise<Contact | null> {
    const [row] = await db
      .select()
      .from(contacts)
      .where(
        and(
          eq(contacts.originalId, originalId),
          eq(contacts.type, type),
          eq(contacts.businessId, businessId),
        ),
      )
      .limit(1);
    return row ?? null;
  }
}
