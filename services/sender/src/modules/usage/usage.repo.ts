import { and, desc, eq, isNotNull } from "drizzle-orm";
import { db } from "#core/db";
import { dailyUsage, type DailyUsage } from "./usage.table";

export class UsageRepository {
  async get(userId: number, day: string): Promise<DailyUsage> {
    const [row] = await db
      .select({ emailsSent: dailyUsage.emailsSent, whatsappSent: dailyUsage.whatsappSent })
      .from(dailyUsage)
      .where(and(eq(dailyUsage.userId, userId), eq(dailyUsage.day, day)))
      .limit(1);
    return row ?? { emailsSent: 0, whatsappSent: 0 };
  }

  /** Last send across days: pacing must not reset at midnight. */
  async lastSentAt(userId: number): Promise<Date | null> {
    const [row] = await db
      .select({ at: dailyUsage.lastMessageSentAt })
      .from(dailyUsage)
      .where(and(eq(dailyUsage.userId, userId), isNotNull(dailyUsage.lastMessageSentAt)))
      .orderBy(desc(dailyUsage.day))
      .limit(1);
    return row?.at ?? null;
  }
}
