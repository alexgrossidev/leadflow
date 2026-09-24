import type { DnsResolver, EmailCheck, EmailCheckResult } from "../types/check.types";

function detectProvider(mxHosts: string[]): string | null {
  const joined = mxHosts.join(" ").toLowerCase();

  if (joined.includes("google")) {
    return "google";
  }

  if (joined.includes("outlook") || joined.includes("protection.outlook")) {
    return "microsoft";
  }

  if (joined.includes("yahoodns")) {
    return "yahoo";
  }

  if (joined.includes("icloud")) {
    return "apple";
  }

  if (joined.includes("proton")) {
    return "proton";
  }

  return null;
}

export class ProviderCheck implements EmailCheck<{ provider: string | null }> {
  name = "provider" as const;

  constructor(private readonly dns: DnsResolver) {}

  async run({
    domain,
  }: {
    domain: string;
  }): Promise<EmailCheckResult<{ provider: string | null }>> {
    try {
      const mxRecords = await this.dns.resolveMx(domain);

      const provider = detectProvider(
        mxRecords.map((record) => record.exchange),
      );

      return {
        name: this.name,
        success: true,
        score: provider ? 10 : 0,
        data: {
          provider,
        },
      };
    } catch {
      return {
        name: this.name,
        success: false,
        score: 0,
        reason: "Provider detection failed",
        data: {
          provider: null,
        },
      };
    }
  }
}
