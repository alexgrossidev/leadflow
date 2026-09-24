import type { MxRecord } from "node:dns";
import type { DnsResolver } from "../types/check.types";

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Wraps a resolver so every lookup is bounded by `timeoutMs` and each
 * name is resolved at most once per inspection (MX feeds two checks).
 */
export function boundedResolver(inner: DnsResolver, timeoutMs: number): DnsResolver {
  const mx = new Map<string, Promise<MxRecord[]>>();
  const txt = new Map<string, Promise<string[][]>>();
  return {
    resolveMx(domain) {
      let hit = mx.get(domain);
      if (!hit) {
        hit = withTimeout(inner.resolveMx(domain), timeoutMs, "MX lookup");
        mx.set(domain, hit);
      }
      return hit;
    },
    resolveTxt(domain) {
      let hit = txt.get(domain);
      if (!hit) {
        hit = withTimeout(inner.resolveTxt(domain), timeoutMs, "TXT lookup");
        txt.set(domain, hit);
      }
      return hit;
    },
  };
}
