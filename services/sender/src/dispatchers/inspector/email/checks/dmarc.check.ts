import type { DnsResolver, EmailCheck, EmailCheckResult } from "../types/check.types";
import { optionalProp } from "../utils/optionalProp";

export class DmarcCheck implements EmailCheck<{ hasDmarc: boolean }> {
  name = "dmarc" as const;

  constructor(private readonly dns: DnsResolver) {}

  async run({
    domain,
  }: {
    domain: string;
  }): Promise<EmailCheckResult<{ hasDmarc: boolean }>> {
    try {
      const txtRecords = await this.dns.resolveTxt(`_dmarc.${domain}`);

      const hasDmarc = txtRecords.some((record) =>
        record.join("").startsWith("v=DMARC1"),
      );

      return {
        name: this.name,
        success: hasDmarc,
        score: hasDmarc ? 10 : 0,
        ...optionalProp(
          "reason",
          hasDmarc ? undefined : "DMARC record missing",
        ),
        data: {
          hasDmarc,
        },
      };
    } catch {
      return {
        name: this.name,
        success: false,
        score: 0,
        reason: "DMARC lookup failed",
        data: {
          hasDmarc: false,
        },
      };
    }
  }
}
