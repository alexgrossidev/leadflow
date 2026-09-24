import type { EmailCheck, EmailCheckResult } from "../types/check.types";
import { optionalProp } from "../utils/optionalProp";

const disposableDomains = new Set<string>([
  "mailinator.com",
  "10minutemail.com",
]);

export class DisposableCheck implements EmailCheck<{ disposable: boolean }> {
  name = "disposable" as const;

  async run({
    domain,
  }: {
    domain: string;
  }): Promise<EmailCheckResult<{ disposable: boolean }>> {
    const disposable = disposableDomains.has(domain);

    return {
      name: this.name,
      success: !disposable,
      score: disposable ? -50 : 10,
      ...optionalProp(
        "reason",
        disposable ? "Disposable email provider" : undefined,
      ),
      data: {
        disposable,
      },
    };
  }
}
