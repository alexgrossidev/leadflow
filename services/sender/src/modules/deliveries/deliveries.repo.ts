import { eq, sql } from "drizzle-orm";
import { db } from "#core/db";
import { dailyUsage } from "../usage/usage.table";
import { sentMessages, type DeliveryRecord } from "./deliveries.table";

export class DeliveryRepository {
  async isDelivered(messageKey: string): Promise<boolean> {
    const [row] = await db
      .select({ key: sentMessages.messageKey })
      .from(sentMessages)
      .where(eq(sentMessages.messageKey, messageKey))
      .limit(1);
    return row !== undefined;
  }

  /** Records the send and bumps the user's daily counter in one transaction. */
  async record({ day, ...delivery }: DeliveryRecord): Promise<void> {
    const email = delivery.channel === "email" ? 1 : 0;
    await db.transaction(async (tx) => {
      await tx.insert(sentMessages).values(delivery);
      await tx
        .insert(dailyUsage)
        .values({
          userId: delivery.userId,
          day,
          emailsSent: email,
          whatsappSent: 1 - email,
          lastMessageSentAt: delivery.sentAt,
        })
        .onDuplicateKeyUpdate({
          set: {
            emailsSent: sql`${dailyUsage.emailsSent} + ${email}`,
            whatsappSent: sql`${dailyUsage.whatsappSent} + ${1 - email}`,
            lastMessageSentAt: delivery.sentAt,
          },
        });
    });
  }
}
