import type { MxRecord } from "node:dns";
import type { DnsResolver, EmailCheck, EmailCheckResult } from "../types/check.types";
import { optionalProp } from "../utils/optionalProp";

export class MxCheck implements EmailCheck<{ mxRecords: MxRecord[] }> {
  name = "mx" as const;

  constructor(private readonly dns: DnsResolver) {}

  async run({
    domain,
  }: {
    domain: string;
  }): Promise<EmailCheckResult<{ mxRecords: MxRecord[] }>> {
    try {
      const mxRecords = await this.dns.resolveMx(domain);

      return {
        name: this.name,
        success: mxRecords.length > 0,
        score: mxRecords.length > 0 ? 30 : -100,
        ...optionalProp(
          "reason",
          mxRecords.length > 0 ? undefined : "No MX records found",
        ),
        data: {
          mxRecords,
        },
      };
    } catch {
      return {
        name: this.name,
        success: false,
        score: -100,
        reason: "MX lookup failed",
        data: {
          mxRecords: [],
        },
      };
    }
  }
}
