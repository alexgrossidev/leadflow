import { and, eq } from "drizzle-orm";
import { mainDb } from "#database/mainPool";
import { NewWhatsappNumber, whatsappNumbers } from "./whatsappNumber.table.js";

export class WhatsappNumberRepository {
  async insert(
    data: Pick<NewWhatsappNumber, "businessId" | "userId" | "phoneNumber">,
  ): Promise<void> {
    await mainDb
      .insert(whatsappNumbers)
      .values(data)
      .onDuplicateKeyUpdate({ set: { userId: data.userId } });
  }

  async deleteByBusinessPhone(businessId: number, phoneNumber: string): Promise<void> {
    await mainDb
      .delete(whatsappNumbers)
      .where(
        and(
          eq(whatsappNumbers.businessId, businessId),
          eq(whatsappNumbers.phoneNumber, phoneNumber),
        ),
      );
  }
}
