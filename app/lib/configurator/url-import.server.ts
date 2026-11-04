import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import https from "node:https";
import net from "node:net";
import type { LookupFunction } from "node:net";

import { MAX_RAW_UPLOAD_BYTES } from "~/lib/files";

/*
 * "Add model › From URL": fetch a merchant-supplied .glb/.gltf once so it can
 * go through the normal upload pipeline into Shopify Files.
 *
 * The URL is attacker-controllable input fetched from our own server, so this
 * is the one place an SSRF could start. The guards:
 *
 *  - https only, default port only, no credentials in the URL;
 *  - every resolved address is checked *at connect time*, in the socket's own
 *    DNS lookup — checking a name first and connecting later would let a
 *    rebinding DNS server answer "public" to the check and "127.0.0.1" to the
 *    connection;
 *  - redirects are followed by hand (max 3) and each hop is re-validated;
 *  - the body is capped while streaming, not after.
 */

export const URL_IMPORT_MAX_REDIRECTS = 3;
const TIMEOUT_MS = 30_000;

export type UrlImportCode =
  | "invalid"
  | "https"
  | "credentials"
  | "port"
  | "blocked"
  | "status"
  | "tooLarge"
  | "timeout"
  | "download"
  | "extension"
  | "redirects";

/** Carries a code the route translates (urlErr_<code> in the product3d namespace). */
export class UrlImportError extends Error {
  constructor(
    public code: UrlImportCode,
    public status?: number,
  ) {
    super(code);
  }
}

/** IPv4/IPv6 addresses that must never be reached from the server. */
export function isBlockedAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // CGNAT
      (a === 169 && b === 254) || // link-local, cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224 // multicast + reserved
    );
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === "::" || v === "::1") return true;
    // IPv4-mapped (::ffff:a.b.c.d) — judge the embedded IPv4.
    const mapped = v.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isBlockedAddress(mapped[1]);
    return (
      v.startsWith("fc") ||
      v.startsWith("fd") || // unique local
      v.startsWith("fe8") ||
      v.startsWith("fe9") ||
      v.startsWith("fea") ||
      v.startsWith("feb") || // link-local
      v.startsWith("ff") // multicast
    );
  }
  return true;
}

const safeLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 0);
    const list = addresses as unknown as LookupAddress[];
    const bad = list.find((a) => isBlockedAddress(a.address));
    if (!list.length || bad) {
      return callback(
        new UrlImportError("blocked"),
        "",
        0,
      );
    }
    if ((options as { all?: boolean }).all) {
      (callback as any)(null, list);
    } else {
      callback(null, list[0].address, list[0].family);
    }
  });
};

/** Syntax check shared with the client: https, .glb/.gltf path. */
export const MODEL_URL_PATTERN = /^https:\/\/[^/\s]+\/\S+\.(glb|gltf)(\?\S*)?$/i;

function checkUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UrlImportError("invalid");
  }
  if (url.protocol !== "https:") {
    throw new UrlImportError("https");
  }
  if (url.username || url.password) {
    throw new UrlImportError("credentials");
  }
  if (url.port && url.port !== "443") {
    throw new UrlImportError("port");
  }
  if (net.isIP(url.hostname.replace(/^\[|\]$/g, "")) &&
      isBlockedAddress(url.hostname.replace(/^\[|\]$/g, ""))) {
    throw new UrlImportError("blocked");
  }
  return url;
}

function getOnce(
  url: URL,
): Promise<{ redirect: string } | { body: Buffer; type: string }> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        lookup: safeLookup,
        timeout: TIMEOUT_MS,
        headers: { "user-agent": "Easy3DViewer-Import/1.0", accept: "*/*" },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          resolve({ redirect: new URL(res.headers.location, url).toString() });
          return;
        }
        if (status !== 200) {
          res.resume();
          reject(new UrlImportError("status", status));
          return;
        }
        const declared = Number(res.headers["content-length"] ?? 0);
        if (declared > MAX_RAW_UPLOAD_BYTES) {
          res.destroy();
          reject(new UrlImportError("tooLarge"));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_RAW_UPLOAD_BYTES) {
            res.destroy();
            reject(new UrlImportError("tooLarge"));
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () =>
          resolve({
            body: Buffer.concat(chunks),
            type: String(res.headers["content-type"] ?? ""),
          }),
        );
        res.on("error", reject);
      },
    );
    req.on("timeout", () => {
      req.destroy(new UrlImportError("timeout"));
    });
    req.on("error", (err) =>
      reject(
        err instanceof UrlImportError
          ? err
          : new UrlImportError("download"),
      ),
    );
  });
}

/** Download a model URL as a File, ready for the upload pipeline. */
export async function fetchModelFromUrl(raw: string): Promise<File> {
  let url = checkUrl(raw.trim());
  for (let hop = 0; hop <= URL_IMPORT_MAX_REDIRECTS; hop++) {
    const res = await getOnce(url);
    if ("redirect" in res) {
      url = checkUrl(res.redirect);
      continue;
    }
    const name = decodeURIComponent(url.pathname.split("/").pop() || "model.glb");
    if (!/\.(glb|gltf)$/i.test(name)) {
      throw new UrlImportError("extension");
    }
    const type = name.toLowerCase().endsWith(".gltf")
      ? "model/gltf+json"
      : "model/gltf-binary";
    return new File([new Uint8Array(res.body)], name, { type });
  }
  throw new UrlImportError("redirects");
}
