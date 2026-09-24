import { and, eq } from "drizzle-orm";
import { DbExecutor, mainDb } from "#database/mainPool";
import { Automation, NewAutomation, automations } from "./automation.table.js";

const owned = (id: number, businessId: number) =>
  and(eq(automations.id, id), eq(automations.business_id, businessId));

export class AutomationRepository {
  async insert(data: NewAutomation, db: DbExecutor = mainDb): Promise<number> {
    const [result] = await db.insert(automations).values(data);
    return result.insertId;
  }

  /** Locks the automation row for the rest of the transaction. */
  async findForUpdate(
    id: number,
    businessId: number,
    db: DbExecutor = mainDb,
  ): Promise<Automation | null> {
    const [row] = await db.select().from(automations).where(owned(id, businessId)).for("update");
    return row ?? null;
  }

  async update(
    id: number,
    businessId: number,
    data: Partial<NewAutomation>,
    db: DbExecutor = mainDb,
  ): Promise<void> {
    await db.update(automations).set(data).where(owned(id, businessId));
  }

  async delete(id: number, businessId: number, db: DbExecutor = mainDb): Promise<boolean> {
    const [result] = await db.delete(automations).where(owned(id, businessId));
    return result.affectedRows > 0;
  }
}
