import { distance } from "fastest-levenshtein";
import type { EmailCheck, EmailCheckResult } from "../types/check.types";
import { optionalProp } from "../utils/optionalProp";

/** Mailbox providers whose names are commonly mistyped. */
const PROVIDERS = ["gmail", "hotmail", "outlook", "icloud", "yahoo", "proton", "libero", "virgilio"];

/** Real providers that sit one edit away from a popular one. */
const LOOKALIKES_THAT_EXIST = new Set(["mail", "email", "ymail", "gmx", "aol", "cloud"]);

type TypoData = { likelyTypo: boolean; suggestedProvider: string | null };

/**
 * Flags domains whose provider name is a near miss of a popular one
 * ("gmial.com", "hotmial.it"). Only the name before the TLD is compared, so
 * country variants such as yahoo.it or hotmail.fr are not typos.
 */
export class TypoCheck implements EmailCheck<TypoData> {
  name = "typo" as const;

  async run({ domain }: { domain: string }): Promise<EmailCheckResult<TypoData>> {
    const label = domain.split(".").slice(0, -1).join(".");
    let suggestion: string | null = null;

    if (!PROVIDERS.includes(label) && !LOOKALIKES_THAT_EXIST.has(label)) {
      suggestion =
        PROVIDERS.find((provider) => {
          const d = distance(label, provider);
          return d > 0 && d <= 2; // a swapped pair of letters costs 2
        }) ?? null;
    }

    return {
      name: this.name,
      success: !suggestion,
      score: suggestion ? -25 : 5,
      ...optionalProp("reason", suggestion ? `Possible typo of ${suggestion}` : undefined),
      data: { likelyTypo: Boolean(suggestion), suggestedProvider: suggestion },
    };
  }
}
