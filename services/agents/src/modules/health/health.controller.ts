import { BaseController } from "#core/apifactory/base.controller";
import type { HealthService } from "./health.service.js";

export class HealthController extends BaseController<HealthService> {
  check = this.catchAsync(async (_req, res) => {
    const report = await this.service.check();
    // 503 so an orchestrator's probe actually fails when the database is down.
    if (report.status === "degraded") {
      return res
        .status(503)
        .json({ success: false, message: "Agents service is degraded", data: report });
    }
    return this.ok(res, report, "Agents service is up");
  });
}
