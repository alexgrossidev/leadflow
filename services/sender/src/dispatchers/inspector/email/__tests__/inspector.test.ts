import { describe, expect, it, vi } from "vitest";
import type { MxRecord } from "node:dns";
import { createEmailInspector } from "../inspector";
import type { DnsResolver } from "../types/check.types";

const records: Record<string, { mx?: MxRecord[]; txt?: string[][] }> = {
  "leadflow.dev": {
    mx: [{ exchange: "aspmx.l.google.com", priority: 1 }],
    txt: [["v=spf1 include:_spf.google.com ~all"]],
  },
  "_dmarc.leadflow.dev": { txt: [["v=DMARC1; p=none"]] },
};

const fakeDns: DnsResolver = {
  resolveMx: async (domain) => {
    const mx = records[domain]?.mx;
    if (!mx) throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
    return mx;
  },
  resolveTxt: async (domain) => records[domain]?.txt ?? [],
};

describe("email inspector", () => {
  it("never inspects when turned off", async () => {
    const dns = { resolveMx: vi.fn(), resolveTxt: vi.fn() };
    const result = await createEmailInspector("off", dns).inspect("x@mailinator.com");
    expect(result.action).toBe("SAFE");
    expect(dns.resolveMx).not.toHaveBeenCalled();
  });

  it("basic mode runs offline checks only", async () => {
    const dns = { resolveMx: vi.fn(), resolveTxt: vi.fn() };
    const inspector = createEmailInspector("basic", dns);
    expect((await inspector.inspect("ada@leadflow.dev")).action).toBe("LOW_CONFIDENCE");
    expect((await inspector.inspect("ada@mailinator.com")).action).toBe("BLOCK");
    expect((await inspector.inspect("ada@gmial.com"))).toMatchObject({ action: "RISKY", failed: ["typo"] });
    expect((await inspector.inspect("ada@yahoo.it")).action).toBe("LOW_CONFIDENCE");
    expect(dns.resolveMx).not.toHaveBeenCalled();
  });

  it("full mode trusts a domain with MX, SPF and DMARC", async () => {
    const result = await createEmailInspector("full", fakeDns).inspect("ada@leadflow.dev");
    expect(result).toMatchObject({ action: "SAFE", failed: [] });
  });

  it("full mode blocks a domain without MX records", async () => {
    const result = await createEmailInspector("full", fakeDns).inspect("ada@no-mail.dev");
    expect(result.action).toBe("BLOCK");
    expect(result.failed).toContain("mx");
  });

  it("bounds slow lookups by the timeout", async () => {
    vi.useFakeTimers();
    try {
      const hanging: DnsResolver = {
        resolveMx: () => new Promise(() => {}),
        resolveTxt: () => new Promise(() => {}),
      };
      const pending = createEmailInspector("full", hanging, 50).inspect("ada@leadflow.dev");
      await vi.advanceTimersByTimeAsync(60);
      const result = await pending;
      expect(result.action).toBe("BLOCK"); // an unanswered MX lookup counts as missing
      expect(result.failed).toEqual(expect.arrayContaining(["mx", "spf", "dmarc", "provider"]));
    } finally {
      vi.useRealTimers();
    }
  });
});
