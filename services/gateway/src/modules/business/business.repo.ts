import { and, eq } from "drizzle-orm";
import { mainDb } from "#database/mainPool";
import { Business, NewBusiness, businesses } from "./business.table.js";

export class BusinessRepository {
  async create(data: NewBusiness): Promise<number> {
    const [result] = await mainDb.insert(businesses).values(data);
    return result.insertId;
  }

  async findAllByUserId(userId: number): Promise<Business[]> {
    return mainDb.select().from(businesses).where(eq(businesses.userId, userId));
  }

  async findOwned(id: number, userId: number): Promise<Business | null> {
    const [row] = await mainDb
      .select()
      .from(businesses)
      .where(and(eq(businesses.id, id), eq(businesses.userId, userId)))
      .limit(1);
    return row ?? null;
  }

  /** Returns the number of rows removed (0 or 1). */
  async deleteOwned(id: number, userId: number): Promise<number> {
    const [result] = await mainDb
      .delete(businesses)
      .where(and(eq(businesses.id, id), eq(businesses.userId, userId)));
    return result.affectedRows;
  }

  async updateOwned(
    id: number,
    userId: number,
    data: Partial<NewBusiness>,
  ): Promise<Business | null> {
    return mainDb.transaction(async (tx) => {
      const owned = and(eq(businesses.id, id), eq(businesses.userId, userId));
      await tx.update(businesses).set(data).where(owned);

      // MySQL has no UPDATE ... RETURNING; read back inside the same transaction.
      const [row] = await tx.select().from(businesses).where(owned).limit(1);
      return row ?? null;
    });
  }
}
