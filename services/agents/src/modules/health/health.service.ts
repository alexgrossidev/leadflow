export interface HealthReport {
  status: "ok" | "degraded";
  database: "up" | "down";
  uptime: number;
  timestamp: string;
}

export class HealthService {
  constructor(private readonly pingDatabase: () => Promise<boolean>) {}

  /**
   * Runs are persisted before they execute, so an unreachable database means
   * the service would accept triggers it cannot record. Report that as
   * degraded rather than let a green check hide it.
   */
  async check(): Promise<HealthReport> {
    const dbUp = await this.pingDatabase();
    return {
      status: dbUp ? "ok" : "degraded",
      database: dbUp ? "up" : "down",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    };
  }
}
