import { and, eq, inArray, isNull, notInArray } from "drizzle-orm";
import { DbExecutor, mainDb } from "#database/mainPool";
import { assignedServices } from "./assigned.table.js";
import { services } from "../services/services.table.js";

export class CustomerAssignedServicesRepository {
  async listActive(businessId: number, customerId: number) {
    return mainDb
      .select({ id: assignedServices.id, serviceId: assignedServices.serviceId })
      .from(assignedServices)
      .where(
        and(
          eq(assignedServices.businessId, businessId),
          eq(assignedServices.customerId, customerId),
          isNull(assignedServices.deletedAt),
        ),
      )
      .limit(250);
  }

  /** True when every id is a service of this business. */
  async servicesBelongToBusiness(
    businessId: number,
    serviceIds: number[],
    db: DbExecutor = mainDb,
  ): Promise<boolean> {
    const unique = [...new Set(serviceIds)];
    if (unique.length === 0) return true;
    const rows = await db
      .select({ id: services.id })
      .from(services)
      .where(and(eq(services.businessId, businessId), inArray(services.id, unique)));
    return rows.length === unique.length;
  }

  /** Inserts the assignments, reviving any that were soft-deleted. */
  async upsert(
    businessId: number,
    customerId: number,
    serviceIds: number[],
    db: DbExecutor = mainDb,
  ): Promise<void> {
    if (serviceIds.length === 0) return;
    await db
      .insert(assignedServices)
      .values(serviceIds.map((serviceId) => ({ businessId, customerId, serviceId })))
      .onDuplicateKeyUpdate({ set: { deletedAt: null } });
  }

  /** Soft-deletes the customer's assignments except `keep` (all of them when empty). */
  async removeExcept(
    businessId: number,
    customerId: number,
    keep: number[],
    db: DbExecutor = mainDb,
  ): Promise<void> {
    await db
      .update(assignedServices)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(assignedServices.businessId, businessId),
          eq(assignedServices.customerId, customerId),
          isNull(assignedServices.deletedAt),
          keep.length > 0 ? notInArray(assignedServices.serviceId, keep) : undefined,
        ),
      );
  }

  async remove(businessId: number, customerId: number, serviceId: number): Promise<boolean> {
    const [result] = await mainDb
      .update(assignedServices)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(assignedServices.businessId, businessId),
          eq(assignedServices.customerId, customerId),
          eq(assignedServices.serviceId, serviceId),
          isNull(assignedServices.deletedAt),
        ),
      );
    return result.affectedRows > 0;
  }
}
