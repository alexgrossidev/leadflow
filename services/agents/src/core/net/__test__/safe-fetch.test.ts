import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it, vi } from "vitest";
import {
  BlockedUrlError,
  isPublicAddress,
  nodeTransport,
  safeFetch,
  validateUrl,
  type RawResponse,
  type ResolvedAddress,
  type Resolver,
  type Transport,
} from "../safe-fetch.js";

/** DNS stand-in: hostname -> addresses. Unknown hosts fail to resolve. */
const resolverFor =
  (table: Record<string, string[]>): Resolver =>
  async (hostname) => {
    const addresses = table[hostname];
    if (!addresses) throw new Error("ENOTFOUND");
    return addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
  };

const PUBLIC = "93.184.215.14";

const html = (body: string): RawResponse => ({
  status: 200,
  headers: { "content-type": "text/html" },
  body: Buffer.from(body),
});

const options = (resolver: Resolver, transport: Transport) => ({
  timeoutMs: 1_000,
  maxBytes: 10_000,
  maxRedirects: 3,
  resolver,
  transport,
});

const blocked = async (promise: Promise<unknown>): Promise<BlockedUrlError> => {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(BlockedUrlError);
  return error as BlockedUrlError;
};

describe("isPublicAddress", () => {
  it.each([
    ["127.0.0.1", false],
    ["169.254.169.254", false],
    ["10.1.2.3", false],
    ["172.16.0.1", false],
    ["192.168.1.1", false],
    ["100.64.0.1", false],
    ["0.0.0.0", false],
    ["::1", false],
    ["::", false],
    ["fe80::1", false],
    ["fd00:ec2::254", false],
    ["::ffff:127.0.0.1", false],
    ["::ffff:a9fe:a9fe", false],
    ["64:ff9b::a00:1", false],
    [PUBLIC, true],
    ["2606:4700:4700::1111", true],
    ["::ffff:8.8.8.8", true],
    ["not-an-ip", false],
  ])("%s -> %s", (address, expected) => {
    expect(isPublicAddress(address)).toBe(expected);
  });
});

describe("validateUrl", () => {
  const resolver = resolverFor({ "shop.example.com": [PUBLIC] });

  it.each([
    "http://127.0.0.1/",
    "http://169.254.169.254/latest/meta-data/",
    "http://10.0.0.8/admin",
    "http://[::1]/",
    "http://[::ffff:169.254.169.254]/",
    "file:///etc/passwd",
    "gopher://shop.example.com/",
    "http://user:pass@shop.example.com/",
    "http://shop.example.com:8080/",
  ])("refuses %s", async (url) => {
    await blocked(validateUrl(url, resolver));
  });

  it("refuses a hostname when any resolved address is private (split-horizon)", async () => {
    const mixed = resolverFor({ "mixed.example.com": [PUBLIC, "10.0.0.5"] });
    await blocked(validateUrl("https://mixed.example.com/", mixed));
  });

  it("refuses a hostname that resolves to loopback", async () => {
    const local = resolverFor({ "localtest.example.com": ["127.0.0.1"] });
    await blocked(validateUrl("http://localtest.example.com/", local));
  });

  it("accepts a public host and returns the addresses to pin", async () => {
    const { addresses } = await validateUrl("https://shop.example.com/about", resolver);
    expect(addresses).toEqual([{ address: PUBLIC, family: 4 }]);
  });
});

describe("safeFetch", () => {
  it("connects only to the validated addresses", async () => {
    const transport = vi.fn<Transport>().mockResolvedValue(html("<p>hi</p>"));
    const resolver = resolverFor({ "shop.example.com": [PUBLIC] });

    const response = await safeFetch("https://shop.example.com/", options(resolver, transport));

    expect(response.body?.toString()).toBe("<p>hi</p>");
    const pinned: ResolvedAddress[] = transport.mock.calls[0]![1];
    expect(pinned).toEqual([{ address: PUBLIC, family: 4 }]);
  });

  it("re-validates each redirect hop and refuses a redirect to the metadata endpoint", async () => {
    const transport = vi.fn<Transport>().mockResolvedValueOnce({
      status: 302,
      headers: { location: "http://169.254.169.254/latest/meta-data/iam" },
    });
    const resolver = resolverFor({ "shop.example.com": [PUBLIC] });

    await blocked(safeFetch("https://shop.example.com/", options(resolver, transport)));
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("refuses a relative redirect to a host that resolves privately", async () => {
    const transport = vi.fn<Transport>().mockResolvedValueOnce({
      status: 301,
      headers: { location: "https://internal.example.com/" },
    });
    const resolver = resolverFor({
      "shop.example.com": [PUBLIC],
      "internal.example.com": ["192.168.0.10"],
    });

    await blocked(safeFetch("https://shop.example.com/", options(resolver, transport)));
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it("follows at most maxRedirects hops", async () => {
    const transport = vi.fn<Transport>().mockResolvedValue({
      status: 302,
      headers: { location: "/again" },
    });
    const resolver = resolverFor({ "shop.example.com": [PUBLIC] });

    const error = await blocked(safeFetch("https://shop.example.com/", options(resolver, transport)));
    expect(error.message).toMatch(/redirects/);
    expect(transport).toHaveBeenCalledTimes(4);
  });

  it("follows a public redirect", async () => {
    const transport = vi
      .fn<Transport>()
      .mockResolvedValueOnce({ status: 301, headers: { location: "https://www.shop.example.com/" } })
      .mockResolvedValueOnce(html("home"));
    const resolver = resolverFor({
      "shop.example.com": [PUBLIC],
      "www.shop.example.com": [PUBLIC],
    });

    const response = await safeFetch("https://shop.example.com/", options(resolver, transport));
    expect(response.url.hostname).toBe("www.shop.example.com");
  });

  it("passes a deadline signal to the transport", async () => {
    const transport = vi.fn<Transport>().mockResolvedValue(html(""));
    await safeFetch(
      "https://shop.example.com/",
      options(resolverFor({ "shop.example.com": [PUBLIC] }), transport),
    );
    const { signal, maxBytes } = transport.mock.calls[0]![2];
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(maxBytes).toBe(10_000);
  });
});

describe("nodeTransport", () => {
  it("connects to the pinned address without a DNS lookup and stops reading at the byte cap", async () => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/html" });
      res.end("x".repeat(1_000_000));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    try {
      // The hostname does not exist; only the pinned address makes this work.
      const response = await nodeTransport(
        new URL(`http://pinned-host.invalid:${port}/`),
        [{ address: "127.0.0.1", family: 4 }],
        { signal: AbortSignal.timeout(5_000), maxBytes: 1_000 },
      );
      expect(response.status).toBe(200);
      expect(response.body?.length).toBe(1_000);
    } finally {
      server.close();
    }
  });
});
