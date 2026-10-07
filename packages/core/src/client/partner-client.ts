import { z } from "zod";
import type { EndpointPath } from "./endpoints.js";
import { PartnerApiError, kindForStatus } from "./errors.js";

export const EnvelopeSchema = z.object({
  code: z.coerce.number().int().optional(),
  message: z.string().nullish(),
  data: z.unknown(),
});

export interface PartnerClientOptions {
  baseUrl: string;
  timeoutMs: number;
  /** Retries after the first attempt on 429, 5xx, timeouts and network errors. Brief: at most 2. */
  maxRetries?: number;
  fetch?: typeof fetch;
  /** Injected for tests. */
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export interface CallResult {
  data: unknown;
  status: number;
  attempts: number;
  latencyMs: number;
}

const MAX_DETAIL = 300;

/**
 * Client for the 22 global Partner API paths. The API key is passed per call,
 * used only in the `api-key` header, and scrubbed from anything it returns.
 */
export class PartnerApiClient {
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;

  constructor(opts: PartnerClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.timeoutMs = opts.timeoutMs;
    this.maxRetries = Math.min(opts.maxRetries ?? 2, 2);
    this.fetchImpl = opts.fetch ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.random = opts.random ?? Math.random;
  }

  async call(path: EndpointPath, body: Record<string, unknown>, apiKey: string, signal?: AbortSignal): Promise<CallResult> {
    const started = Date.now();
    let attempt = 0;
    for (;;) {
      attempt++;
      try {
        const res = await this.once(path, body, apiKey, signal);
        return { ...res, attempts: attempt, latencyMs: Date.now() - started };
      } catch (err) {
        const e = err instanceof PartnerApiError ? err : new PartnerApiError("network", null, null, path);
        if (!e.retryable || attempt > this.maxRetries || signal?.aborted) throw e;
        // Jittered exponential backoff: ~250 ms, ~500 ms.
        const base = 250 * 2 ** (attempt - 1);
        await this.sleep(base / 2 + this.random() * base);
      }
    }
  }

  private async once(path: EndpointPath, body: Record<string, unknown>, apiKey: string, signal?: AbortSignal) {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", "api-key": apiKey },
        body: JSON.stringify(body),
        signal: combined,
      });
    } catch {
      // Never surface the underlying error: some runtimes include request details.
      throw new PartnerApiError(timeout.aborted ? "timeout" : "network", null, null, path);
    }

    let text: string;
    try {
      text = await res.text();
    } catch {
      throw new PartnerApiError(timeout.aborted ? "timeout" : "network", res.status, null, path);
    }
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    const envelope = EnvelopeSchema.safeParse(json);
    const detail = envelope.success ? sanitizeDetail(envelope.data.message, apiKey) : null;

    if (!res.ok) throw new PartnerApiError(kindForStatus(res.status), res.status, detail, path);
    if (!envelope.success) throw new PartnerApiError("bad_response", res.status, null, path);
    // Some APIs return HTTP 200 with an error code in the body.
    const code = envelope.data.code;
    if (code !== undefined && code >= 400) throw new PartnerApiError(kindForStatus(code), code, detail, path);
    return { data: envelope.data.data, status: res.status };
  }
}

/** Remove the key (and its 8-char prefix) from API text, collapse whitespace and truncate. */
export function sanitizeDetail(message: string | null | undefined, apiKey: string): string | null {
  if (!message) return null;
  let m = message.split(apiKey).join("[redacted]");
  if (apiKey.length >= 8) m = m.split(apiKey.slice(0, 8)).join("[redacted]");
  m = m.replace(/\s+/g, " ").trim();
  return m.length > MAX_DETAIL ? `${m.slice(0, MAX_DETAIL)}…` : m || null;
}
