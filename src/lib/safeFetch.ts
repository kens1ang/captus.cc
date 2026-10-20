import http from "node:http";
import https from "node:https";
import net from "node:net";
import dns from "node:dns";
import zlib from "node:zlib";
import type { LookupFunction } from "node:net";

// Fetches a page from a URL a business owner typed in (lib/businessImport.ts).
// That makes it an SSRF surface: a "website" of http://10.0.0.5:6379 or
// http://169.254.169.254 would otherwise have this server reach into its own
// private network (Render's internal Redis/Postgres, cloud metadata). So the
// address check happens inside the socket's DNS lookup — the IP that's
// checked is the IP that's connected to, every hop of every redirect, with
// no window for a DNS answer to change in between (rebinding).

const MAX_BYTES = 2 * 1024 * 1024;
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 4;
// Honest about who we are — some sites (Instagram, Facebook) still serve
// their link-preview tags to a declared bot.
const USER_AGENT = "Mozilla/5.0 (compatible; CaptusBot/1.0; +https://captus.cc)";

const blocked = new net.BlockList();
for (const [addr, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(addr, prefix, "ipv4");
}
for (const [addr, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blocked.addSubnet(addr, prefix, "ipv6");
}

function isBlockedAddress(address: string, family: number): boolean {
  // IPv4-mapped IPv6 (::ffff:10.0.0.1) is the IPv4 address in disguise.
  const mapped = address.toLowerCase().startsWith("::ffff:") ? address.slice(7) : null;
  if (mapped && net.isIPv4(mapped)) return blocked.check(mapped, "ipv4");
  return blocked.check(address, family === 6 ? "ipv6" : "ipv4");
}

export class FetchBlockedError extends Error {}

function makeLookup(allowPrivate: boolean): LookupFunction {
  return (hostname, options, callback) => {
    dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
      if (err) return callback(err, "", 0);
      const list = addresses as dns.LookupAddress[];
      const safe = allowPrivate ? list : list.filter((a) => !isBlockedAddress(a.address, a.family));
      if (safe.length === 0) return callback(new FetchBlockedError(`${hostname} resolves to a private address`), "", 0);
      if (options.all) return (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, safe);
      callback(null, safe[0].address, safe[0].family);
    });
  };
}

export interface FetchedPage {
  url: string; // after redirects
  status: number;
  contentType: string;
  body: string;
}

function requestOnce(url: URL, allowPrivate: boolean): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    // A literal IP skips DNS (and so the lookup hook) entirely — check it here.
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const ipFamily = net.isIP(host);
    if (ipFamily && !allowPrivate && isBlockedAddress(host, ipFamily)) {
      return reject(new FetchBlockedError(`${host} is a private address`));
    }
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request(
      url,
      {
        method: "GET",
        lookup: makeLookup(allowPrivate),
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.5",
          "Accept-Language": "en,ms;q=0.8,zh;q=0.7",
          "Accept-Encoding": "gzip, deflate, br",
        },
        timeout: TIMEOUT_MS,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        const encoding = String(res.headers["content-encoding"] ?? "").toLowerCase();
        const stream =
          encoding === "gzip" ? res.pipe(zlib.createGunzip()) : encoding === "br" ? res.pipe(zlib.createBrotliDecompress()) : encoding === "deflate" ? res.pipe(zlib.createInflate()) : res;
        stream.on("data", (chunk: Buffer) => {
          size += chunk.length;
          // Big pages are cut, not failed — the useful part (head tags, main
          // text) is near the top anyway.
          if (size > MAX_BYTES) {
            req.destroy();
            resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) });
            return;
          }
          chunks.push(chunk);
        });
        stream.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
        stream.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new Error(`Timed out after ${TIMEOUT_MS / 1000}s`)));
    req.on("error", reject);
    req.end();
  });
}

/** GET a public web page (http/https only, no private addresses, ≤2 MB, follows a few redirects). */
export async function safeFetch(rawUrl: string, opts: { allowPrivate?: boolean } = {}): Promise<FetchedPage> {
  let url = new URL(rawUrl);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new FetchBlockedError(`Unsupported protocol ${url.protocol}`);
    if (url.username || url.password) throw new FetchBlockedError("URLs with credentials aren't fetched");
    const res = await requestOnce(url, opts.allowPrivate ?? false);
    const location = res.headers.location;
    if (res.status >= 300 && res.status < 400 && location) {
      url = new URL(location, url);
      continue;
    }
    return {
      url: url.toString(),
      status: res.status,
      contentType: String(res.headers["content-type"] ?? ""),
      body: res.body.toString("utf8"),
    };
  }
  throw new Error(`Too many redirects from ${rawUrl}`);
}
