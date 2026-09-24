import type { DnsResolver, EmailCheck, EmailCheckResult } from "../types/check.types";
import { optionalProp } from "../utils/optionalProp";

export class SpfCheck implements EmailCheck<{ hasSpf: boolean }> {
  name = "spf" as const;

  constructor(private readonly dns: DnsResolver) {}

  async run({
    domain,
  }: {
    domain: string;
  }): Promise<EmailCheckResult<{ hasSpf: boolean }>> {
    try {
      const txtRecords = await this.dns.resolveTxt(domain);

      const hasSpf = txtRecords.some((record) =>
        record.join("").startsWith("v=spf1"),
      );

      return {
        name: this.name,
        success: hasSpf,
        score: hasSpf ? 5 : 0,
        ...optionalProp("reason", hasSpf ? undefined : "SPF record missing"),
        data: {
          hasSpf,
        },
      };
    } catch {
      return {
        name: this.name,
        success: false,
        score: 0,
        reason: "SPF lookup failed",
        data: {
          hasSpf: false,
        },
      };
    }
  }
}
