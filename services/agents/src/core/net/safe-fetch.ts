import { BlockList, isIP } from "node:net";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import http from "node:http";
import https from "node:https";

/**
 * Outbound HTTP for URLs that came from untrusted text (an owner's onboarding
 * message). Without a guard, "my site is http://169.254.169.254/latest/..."
 * turns the service into a proxy for the cloud metadata endpoint or anything
 * else on the internal network.
 *
 * Defences, in order:
 *   1. http/https only, default ports only, no credentials in the URL.
 *   2. The hostname is resolved and *every* address must be public; one private
 *      answer is enough to refuse (a split-horizon trick).
 *   3. The connection is pinned to the addresses that were checked, via the
 *      socket's `lookup` hook, so a second DNS answer (rebinding) cannot swap
 *      in a private address between check and connect.
 *   4. Redirects are followed by hand, each hop re-validated from step 1, up
 *      to a small hop limit.
 *   5. The body is read up to a byte cap and the whole exchange is bounded by
 *      a timeout.
 */

export class BlockedUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BlockedUrlError";
  }
}

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

/** DNS resolution, injectable so tests never touch the network. */
export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

export interface RawResponse {
  status: number;
  headers: Record<string, string | undefined>;
  /** Body read up to the cap; undefined for redirects. */
  body?: Buffer;
}

/** Performs one request to a pre-validated URL, connecting only to `addresses`. */
export type Transport = (
  url: URL,
  addresses: ResolvedAddress[],
  options: { signal: AbortSignal; maxBytes: number },
) => Promise<RawResponse>;

export interface SafeFetchOptions {
  timeoutMs: number;
  maxBytes: number;
  maxRedirects: number;
  signal?: AbortSignal;
  resolver?: Resolver;
  transport?: Transport;
}

const BLOCKED = new BlockList();
// IPv4: "this network", private, CGNAT, loopback, link-local (incl. the
// 169.254.169.254 metadata endpoint), IETF protocol assignments, the three
// documentation nets, benchmarking, multicast and reserved/broadcast.
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  BLOCKED.addSubnet(net, prefix, "ipv4");
}
// IPv6: unspecified, loopback, discard, unique-local (fc00::/7, which covers
// cloud metadata at fd00:ec2::254), link-local, multicast, documentation.
// IPv4-mapped and NAT64 forms are unwrapped and checked as IPv4 below.
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["100::", 64],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
  ["2001:db8::", 32],
] as const) {
  BLOCKED.addSubnet(net, prefix, "ipv6");
}

/** The IPv4 address embedded in an IPv4-mapped (::ffff:a.b.c.d) or NAT64 (64:ff9b::/96) address. */
const embeddedIpv4 = (address: string): string | undefined => {
  const lower = address.toLowerCase();
  const dotted = lower.match(/^(?:::ffff:|64:ff9b::)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) return dotted[1];
  const hex = lower.match(/^(?:::ffff:|64:ff9b::)([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const high = parseInt(hex[1]!, 16);
    const low = parseInt(hex[2]!, 16);
    return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
  }
  return undefined;
};

/** Whether an IP literal is routable on the public internet. */
export const isPublicAddress = (address: string): boolean => {
  const family = isIP(address);
  if (family === 4) return !BLOCKED.check(address, "ipv4");
  if (family === 6) {
    const v4 = embeddedIpv4(address);
    if (v4 !== undefined) return isPublicAddress(v4);
    return !BLOCKED.check(address, "ipv6");
  }
  return false;
};

export const systemResolver: Resolver = (hostname) =>
  new Promise((resolve, reject) => {
    dnsLookup(hostname, { all: true, verbatim: true }, (error, addresses: LookupAddress[]) => {
      if (error) return reject(error);
      resolve(
        addresses.map((entry) => ({
          address: entry.address,
          family: entry.family === 6 ? 6 : 4,
        })),
      );
    });
  });

/** Steps 1 and 2: validates a URL and returns the public addresses to pin. */
export const validateUrl = async (
  raw: string | URL,
  resolver: Resolver,
): Promise<{ url: URL; addresses: ResolvedAddress[] }> => {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BlockedUrlError("Not a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BlockedUrlError(`Scheme ${url.protocol} is not allowed`);
  }
  if (url.username || url.password) {
    throw new BlockedUrlError("Credentials in URLs are not allowed");
  }
  // An empty port is the scheme default; anything else is an internal-service
  // port scan waiting to happen.
  if (url.port !== "") {
    throw new BlockedUrlError(`Port ${url.port} is not allowed`);
  }

  const host = url.hostname.replace(/^\[|\]$/g, "");
  const literalFamily = isIP(host);
  const addresses: ResolvedAddress[] = literalFamily
    ? [{ address: host, family: literalFamily === 6 ? 6 : 4 }]
    : await resolver(host).catch(() => {
        throw new BlockedUrlError(`Could not resolve ${host}`);
      });

  if (addresses.length === 0) throw new BlockedUrlError(`${host} has no addresses`);
  const blocked = addresses.find((entry) => !isPublicAddress(entry.address));
  if (blocked) {
    throw new BlockedUrlError(`${host} resolves to a non-public address`);
  }
  return { url, addresses };
};

/**
 * Fetches a URL from untrusted input under the guard described above. Throws
 * BlockedUrlError when a hop is refused; other errors are network failures.
 */
export const safeFetch = async (
  target: string,
  options: SafeFetchOptions,
): Promise<RawResponse & { url: URL }> => {
  const resolver = options.resolver ?? systemResolver;
  const transport = options.transport ?? nodeTransport;
  const signal = options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(options.timeoutMs)])
    : AbortSignal.timeout(options.timeoutMs);

  let next: string | URL = target;
  for (let hop = 0; ; hop++) {
    const { url, addresses } = await validateUrl(next, resolver);
    const response = await transport(url, addresses, { signal, maxBytes: options.maxBytes });

    const location = response.headers.location;
    if (response.status >= 300 && response.status < 400 && location) {
      if (hop >= options.maxRedirects) {
        throw new BlockedUrlError(`More than ${options.maxRedirects} redirects`);
      }
      next = new URL(location, url);
      continue;
    }
    return { ...response, url };
  }
};

/**
 * node:http(s) transport pinned to the validated addresses. The socket's
 * `lookup` hook answers with the checked addresses instead of asking DNS
 * again, while TLS still verifies the certificate against the real hostname.
 */
export const nodeTransport: Transport = (url, addresses, { signal, maxBytes }) =>
  new Promise((resolve, reject) => {
    const client = url.protocol === "https:" ? https : http;
    const request = client.request(
      url,
      {
        method: "GET",
        signal,
        headers: { accept: "text/html,text/plain;q=0.9", "user-agent": "leadflow-agents/1.0" },
        lookup: (_hostname, lookupOptions, callback) => {
          if (lookupOptions.all) {
            callback(null, addresses);
          } else {
            const first = addresses[0]!;
            callback(null, first.address, first.family);
          }
        },
      },
      (response) => {
        const headers: RawResponse["headers"] = {};
        for (const [name, value] of Object.entries(response.headers)) {
          headers[name] = Array.isArray(value) ? value.join(", ") : value;
        }
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          response.resume();
          return resolve({ status, headers });
        }

        const chunks: Buffer[] = [];
        let total = 0;
        response.on("data", (chunk: Buffer) => {
          const room = maxBytes - total;
          chunks.push(room < chunk.length ? chunk.subarray(0, room) : chunk);
          total += Math.min(chunk.length, room);
          // Stop reading once the cap is hit; the rest of a huge page is never downloaded.
          if (total >= maxBytes) response.destroy();
        });
        const finish = () => resolve({ status, headers, body: Buffer.concat(chunks) });
        response.on("end", finish);
        response.on("close", finish);
        response.on("error", (error) => (total >= maxBytes ? finish() : reject(error)));
      },
    );
    request.on("error", reject);
    request.end();
  });
