import type { EmailCheck } from "../types/check.types";

/** Holds the checks an inspection runs; each check may be registered once. */
export class EmailCheckRegistry {
  private readonly checks = new Map<string, EmailCheck>();

  register(check: EmailCheck): void {
    if (this.checks.has(check.name)) {
      throw new Error(`Email check already registered: ${check.name}`);
    }
    this.checks.set(check.name, check);
  }

  getAll(): EmailCheck[] {
    return [...this.checks.values()];
  }
}
