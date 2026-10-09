// Shared helpers for scripts that call the live Partner API with the test key.
// The key is only ever placed in the `api-key` request header. Anything that
// is printed or written goes through scrub() first.
import { keyFingerprint, loadCoreConfig, readApiKey } from "@bold-mcp/core";

export interface LiveContext {
  baseUrl: string;
  timeoutMs: number;
  fingerprint: string;
  post(path: string, body: unknown, opts?: { key?: string }): Promise<{ status: number; body: unknown; ms: number }>;
  scrub<T>(value: T): T;
}

export function liveContext(): LiveContext {
  const config = loadCoreConfig();
  const apiKey = readApiKey(["BOLD_TEST_API_KEY"]);
  if (!apiKey) {
    process.stderr.write("BOLD_TEST_API_KEY is not set. Add the test key to the environment (never to a file in the repo).\n");
    process.exit(2);
  }
  const prefix = apiKey.slice(0, 8);
  const scrub = <T>(value: T): T => {
    const text = JSON.stringify(value);
    if (text === undefined) return value;
    return JSON.parse(text.split(apiKey).join("[REDACTED]").split(prefix).join("[REDACTED]")) as T;
  };
  return {
    baseUrl: config.BOLD_API_BASE_URL,
    timeoutMs: config.BOLD_API_TIMEOUT_MS,
    fingerprint: keyFingerprint(apiKey),
    scrub,
    async post(path, body, opts) {
      const started = Date.now();
      const res = await fetch(`${config.BOLD_API_BASE_URL}/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", "api-key": opts?.key ?? apiKey },
        body: JSON.stringify(body ?? {}),
        signal: AbortSignal.timeout(config.BOLD_API_TIMEOUT_MS),
      });
      const text = await res.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { non_json_body: text.slice(0, 500) };
      }
      return { status: res.status, body: scrub(parsed), ms: Date.now() - started };
    },
  };
}

export interface PoolBalance {
  total: number;
  used: number;
  remaining: number;
}

export function readBalances(body: unknown): Record<"data" | "contact" | "kyb", PoolBalance> | null {
  const credits = (body as { data?: { credits?: Record<string, PoolBalance> } } | null)?.data?.credits;
  if (!credits) return null;
  const pick = (k: string): PoolBalance => {
    const p = credits[k] ?? { total: NaN, used: NaN, remaining: NaN };
    return { total: Number(p.total), used: Number(p.used), remaining: Number(p.remaining) };
  };
  return { data: pick("data_credits"), contact: pick("contact_credits"), kyb: pick("kyb_credits") };
}
