import { DbExecutor, mainDb } from "#database/mainPool";
import { NewAuditLog, auditLogs } from "./audit.table.js";

export class AuditLogRepository {
  async create(data: NewAuditLog, db: DbExecutor = mainDb): Promise<void> {
    await db.insert(auditLogs).values(data);
  }
}
