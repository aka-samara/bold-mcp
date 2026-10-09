import type { IncomingHttpHeaders } from "node:http";
import { ApiKeySchema, DEFAULT_SETTINGS, type SpendingSettings } from "@bold-mcp/core";

export const OAUTH_TOKEN_PREFIX = "boldmcp_";

export type Credential =
  | { kind: "none" }
  | { kind: "api_key"; apiKey: string }
  | { kind: "oauth_token"; token: string }
  | { kind: "malformed"; reason: string };

/** Query parameters that look like a key. Their presence is refused (never accept a key in the URL). */
const URL_KEY_PARAMS = /^(api[-_]?key|apikey|key|token|access[-_]?token|auth|authorization)$/i;

export function hasKeyInUrl(url: string): boolean {
  const q = url.indexOf("?");
  if (q < 0) return false;
  for (const name of new URLSearchParams(url.slice(q + 1)).keys()) if (URL_KEY_PARAMS.test(name)) return true;
  return false;
}

function header(headers: IncomingHttpHeaders, name: string): string | undefined {
  const v = headers[name];
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Header mode: `Authorization: Bearer <api_key>` or `api-key: <api_key>`.
 * Values starting with `boldmcp_` are OAuth access tokens; anything else is an API key.
 */
export function readCredential(headers: IncomingHttpHeaders): Credential {
  const auth = header(headers, "authorization");
  let value: string | undefined;
  if (auth !== undefined) {
    const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
    if (!m?.[1]) return { kind: "malformed", reason: "Authorization header must be 'Bearer <API key>'" };
    value = m[1].trim();
  } else {
    value = header(headers, "api-key")?.trim();
  }
  if (!value) return { kind: "none" };
  if (value.startsWith(OAUTH_TOKEN_PREFIX)) return { kind: "oauth_token", token: value };
  const parsed = ApiKeySchema.safeParse(value);
  if (!parsed.success) return { kind: "malformed", reason: "The API key format is not valid" };
  return { kind: "api_key", apiKey: parsed.data };
}

function boolHeader(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined) return fallback;
  const s = v.trim().toLowerCase();
  if (["false", "0", "no", "off"].includes(s)) return false;
  if (["true", "1", "yes", "on"].includes(s)) return true;
  return fallback;
}

function intHeader(v: string | undefined, fallback: number, max: number): number {
  if (v === undefined) return fallback;
  const n = Number(v.trim());
  return Number.isInteger(n) && n >= 0 ? Math.min(n, max) : fallback;
}

/** Header-mode spending settings (brief: X-Bold-* headers). */
export function settingsFromHeaders(headers: IncomingHttpHeaders): SpendingSettings {
  return {
    perCallLimit: intHeader(header(headers, "x-bold-max-credits"), DEFAULT_SETTINGS.perCallLimit, 100_000),
    dailyLimit: intHeader(header(headers, "x-bold-daily-credits"), DEFAULT_SETTINGS.dailyLimit, 1_000_000),
    allowContactUnlocks: boolHeader(header(headers, "x-bold-allow-contacts"), DEFAULT_SETTINGS.allowContactUnlocks),
    allowKybUnlocks: boolHeader(header(headers, "x-bold-allow-kyb"), DEFAULT_SETTINGS.allowKybUnlocks),
  };
}
