import { EmailCheckRegistry } from "./checks/check-registry";
import { DisposableCheck } from "./checks/disposable.check";
import { DmarcCheck } from "./checks/dmarc.check";
import { MxCheck } from "./checks/mx.check";
import { ProviderCheck } from "./checks/provider.check";
import { SpfCheck } from "./checks/spf.check";
import { TypoCheck } from "./checks/typo.check";
import { evaluateAction, type InspectionAction } from "./scoring";
import type { DnsResolver, EmailCheckName } from "./types/check.types";
import { boundedResolver } from "./utils/dns";
import { parseEmail } from "./utils/parse-email";

export type InspectionMode = "off" | "basic" | "full";

export interface Inspection {
  action: InspectionAction;
  score: number;
  failed: EmailCheckName[];
}

export interface EmailInspector {
  inspect(email: string): Promise<Inspection>;
}

const NOT_INSPECTED: Inspection = { action: "SAFE", score: 0, failed: [] };

/**
 * Deliverability checks run before an email is sent. "basic" is offline
 * (typo + disposable domain); "full" adds MX, SPF, DMARC and provider lookups,
 * each bounded by `dnsTimeoutMs` so a slow resolver cannot stall the pipeline.
 */
export function createEmailInspector(
  mode: InspectionMode,
  resolver: DnsResolver,
  dnsTimeoutMs = 3_000,
): EmailInspector {
  return {
    async inspect(email) {
      if (mode === "off") return NOT_INSPECTED;
      const { domain } = parseEmail(email);

      const registry = new EmailCheckRegistry();
      registry.register(new TypoCheck());
      registry.register(new DisposableCheck());
      if (mode === "full") {
        const dns = boundedResolver(resolver, dnsTimeoutMs);
        registry.register(new MxCheck(dns));
        registry.register(new SpfCheck(dns));
        registry.register(new DmarcCheck(dns));
        registry.register(new ProviderCheck(dns));
      }

      const results = await Promise.all(
        registry.getAll().map((check) => check.run({ email: email.toLowerCase(), domain })),
      );
      const score = results.reduce((sum, r) => sum + r.score, 0);
      return {
        action: evaluateAction(score, results),
        score,
        failed: results.filter((r) => !r.success).map((r) => r.name),
      };
    },
  };
}
