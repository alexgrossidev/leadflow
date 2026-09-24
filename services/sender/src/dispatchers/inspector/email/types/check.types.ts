import type { MxRecord } from "node:dns";

export type EmailCheckName = "mx" | "spf" | "dmarc" | "disposable" | "provider" | "typo";

/** The DNS lookups the checks need; injected so tests never touch the network. */
export interface DnsResolver {
  resolveMx(domain: string): Promise<MxRecord[]>;
  resolveTxt(domain: string): Promise<string[][]>;
}

export interface EmailValidationContext {
  email: string;
  domain: string;
}

export interface EmailCheckResult<T = unknown> {
  name: EmailCheckName;
  success: boolean;
  score: number;
  reason?: string;
  data: T;
}

export interface EmailCheck<T = unknown> {
  name: EmailCheckName;
  run(context: EmailValidationContext): Promise<EmailCheckResult<T>>;
}
