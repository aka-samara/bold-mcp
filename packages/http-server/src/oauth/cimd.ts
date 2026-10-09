import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";
import { z } from "zod";
import type { OAuthClient } from "../db/types.js";
import { isAcceptableRedirect } from "./redirects.js";

/**
 * Client ID Metadata Document fetcher (brief: HTTPS only, 5-second timeout,
 * size limit, no private-IP targets). DNS is resolved and checked once, and
 * the connection is pinned to the checked address, so a rebinding DNS answer
 * cannot redirect the fetch.
 */

export const CIMD_TIMEOUT_MS = 5000;
export const CIMD_MAX_BYTES = 64 * 1024;

export class CimdError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CimdError";
  }
}

export function isPrivateAddress(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a = 0, b = 0] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127) || a >= 224 || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19))
    );
  }
  const v = ip.toLowerCase();
  if (v === "::" || v === "::1") return true;
  if (v.startsWith("::ffff:")) return isPrivateAddress(v.slice(7));
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v) || v.startsWith("64:ff9b:") || v.startsWith("2001:db8");
}

const MetadataSchema = z.object({
  client_id: z.string(),
  client_name: z.string().max(200).optional(),
  redirect_uris: z.array(z.string()).min(1).max(20),
  token_endpoint_auth_method: z.string().optional(),
  client_uri: z.string().optional(),
  logo_uri: z.string().optional(),
});

export function isCimdClientId(clientId: string): boolean {
  try {
    const u = new URL(clientId);
    return u.protocol === "https:" && u.pathname !== "/" && !u.hash;
  } catch {
    return false;
  }
}

export interface CimdFetcherOptions {
  resolve?: (host: string) => Promise<string[]>;
  fetchImpl?: typeof undiciFetch;
  allowPrivate?: boolean; // tests only
}

export class CimdFetcher {
  private readonly cache = new Map<string, { client: OAuthClient; expires: number }>();
  constructor(private readonly opts: CimdFetcherOptions = {}) {}

  async fetch(clientId: string): Promise<OAuthClient> {
    const cached = this.cache.get(clientId);
    if (cached && cached.expires > Date.now()) return cached.client;
    if (!isCimdClientId(clientId)) throw new CimdError("client_id is not an HTTPS metadata URL");
    const url = new URL(clientId);

    const host = url.hostname.replace(/^\[|\]$/g, "");
    const addresses = isIP(host) ? [host] : await (this.opts.resolve ?? ((h) => lookup(h, { all: true }).then((r) => r.map((x) => x.address))))(host).catch(() => []);
    if (addresses.length === 0) throw new CimdError("client metadata host does not resolve");
    if (!this.opts.allowPrivate && addresses.some(isPrivateAddress)) throw new CimdError("client metadata host is a private address");
    const pinned = addresses[0] as string;

    const dispatcher = new Agent({
      connect: {
        timeout: CIMD_TIMEOUT_MS,
        lookup: (_hostname, _options, cb) => cb(null, [{ address: pinned, family: isIP(pinned) }]),
      },
    });
    let text: string;
    try {
      const res = await (this.opts.fetchImpl ?? undiciFetch)(url, {
        dispatcher,
        redirect: "error",
        signal: AbortSignal.timeout(CIMD_TIMEOUT_MS),
        headers: { accept: "application/json" },
      });
      if (!res.ok) throw new CimdError(`client metadata fetch returned HTTP ${res.status}`);
      const len = Number(res.headers.get("content-length") ?? 0);
      if (len > CIMD_MAX_BYTES) throw new CimdError("client metadata document is too large");
      const reader = res.body?.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > CIMD_MAX_BYTES) {
          await reader.cancel();
          throw new CimdError("client metadata document is too large");
        }
        chunks.push(value);
      }
      text = Buffer.concat(chunks).toString("utf8");
    } catch (err) {
      throw err instanceof CimdError ? err : new CimdError("could not fetch client metadata");
    } finally {
      await dispatcher.close().catch(() => undefined);
    }

    let parsed: z.infer<typeof MetadataSchema>;
    try {
      parsed = MetadataSchema.parse(JSON.parse(text));
    } catch {
      throw new CimdError("client metadata document is not valid");
    }
    if (parsed.client_id !== clientId) throw new CimdError("client metadata client_id does not match its URL");
    if (parsed.token_endpoint_auth_method && parsed.token_endpoint_auth_method !== "none") throw new CimdError("only public clients (token_endpoint_auth_method none) are supported");
    if (!parsed.redirect_uris.every(isAcceptableRedirect)) throw new CimdError("client metadata has an unacceptable redirect_uri");

    const client: OAuthClient = {
      id: clientId,
      kind: "cimd",
      clientName: parsed.client_name ?? url.hostname,
      redirectUris: parsed.redirect_uris,
      metadata: { client_uri: parsed.client_uri ?? null },
    };
    if (this.cache.size > 1000) this.cache.clear();
    this.cache.set(clientId, { client, expires: Date.now() + 10 * 60_000 });
    return client;
  }
}
