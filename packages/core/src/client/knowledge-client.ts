import { z } from "zod";

/**
 * Client for the sales assistant's read-only knowledge API
 * (`POST {url}/api/kb/v1/tools/{name}`). The token is used only in the
 * Authorization header to that origin and scrubbed from anything it returns.
 */

export type KnowledgeErrorKind =
  | "bad_request" // 400: the input was rejected; detail says why
  | "unauthorized" // 401: token missing or wrong
  | "not_found" // 404: API switched off, or the tool doesn't exist there
  | "rate_limited" // 429
  | "server" // 5xx
  | "timeout"
  | "network"
  | "bad_response"; // a body this server could not read

export class KnowledgeApiError extends Error {
  constructor(
    public readonly kind: KnowledgeErrorKind,
    public readonly status: number | null,
    /** The API's own message, scrubbed of the token and truncated; safe to show the AI client. */
    public readonly detail: string | null,
    public readonly tool: string,
    /** From Retry-After on a 429, when given. */
    public readonly retryAfterMs: number | null = null,
  ) {
    super(`Knowledge API ${tool}: ${kind}${status ? ` (HTTP ${status})` : ""}`);
    this.name = "KnowledgeApiError";
  }

  get retryable(): boolean {
    return this.kind === "rate_limited" || this.kind === "server" || this.kind === "timeout" || this.kind === "network";
  }
}

/** What every knowledge tool returns. `data` is the sales assistant's own shape, passed through. */
export const KnowledgeResultSchema = z.object({
  data: z.unknown(),
  source_ids: z.array(z.string()).default([]),
  notes: z.array(z.string()).default([]),
});
export type KnowledgeResult = z.output<typeof KnowledgeResultSchema>;

const ErrorBodySchema = z.object({ error: z.string() });

export interface KnowledgeClientOptions {
  /** Sales assistant origin, without a trailing slash. */
  baseUrl: string;
  token: string;
  timeoutMs: number;
  /** Retries after the first attempt on 429, 5xx, timeouts and network errors. At most 2. */
  maxRetries?: number;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

const MAX_DETAIL = 300;
/** Larger bodies are refused rather than passed to the AI client. */
const MAX_BODY_BYTES = 1024 * 1024;
/** A 429 asking for a longer wait than this is reported instead of waited out. */
const MAX_RETRY_AFTER_MS = 5_000;

export class KnowledgeClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;

  constructor(opts: KnowledgeClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.token = opts.token;
    this.timeoutMs = opts.timeoutMs;
    this.maxRetries = Math.min(opts.maxRetries ?? 2, 2);
    this.fetchImpl = opts.fetch ?? fetch;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.random = opts.random ?? Math.random;
  }

  /** The origin the tools read from, for docs and logs (never carries the token). */
  get origin(): string {
    return this.baseUrl;
  }

  async call(tool: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<KnowledgeResult> {
    let attempt = 0;
    for (;;) {
      attempt++;
      try {
        return await this.once(tool, input, signal);
      } catch (err) {
        const e = err instanceof KnowledgeApiError ? err : new KnowledgeApiError("network", null, null, tool);
        if (!e.retryable || attempt > this.maxRetries || signal?.aborted) throw e;
        if (e.kind === "rate_limited" && e.retryAfterMs !== null) {
          if (e.retryAfterMs > MAX_RETRY_AFTER_MS) throw e;
          await this.sleep(e.retryAfterMs);
          continue;
        }
        // Jittered exponential backoff: ~250 ms, ~500 ms.
        const base = 250 * 2 ** (attempt - 1);
        await this.sleep(base / 2 + this.random() * base);
      }
    }
  }

  private async once(tool: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<KnowledgeResult> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/api/kb/v1/tools/${encodeURIComponent(tool)}`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json", authorization: `Bearer ${this.token}` },
        body: JSON.stringify(input),
        signal: combined,
        redirect: "error",
      });
    } catch {
      // Never surface the underlying error: some runtimes include request details.
      throw new KnowledgeApiError(timeout.aborted ? "timeout" : "network", null, null, tool);
    }

    let text: string;
    try {
      text = await res.text();
    } catch {
      throw new KnowledgeApiError(timeout.aborted ? "timeout" : "network", res.status, null, tool);
    }
    if (Buffer.byteLength(text) > MAX_BODY_BYTES) throw new KnowledgeApiError("bad_response", res.status, null, tool);
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    if (!res.ok) {
      const body = ErrorBodySchema.safeParse(json);
      const detail = body.success ? sanitize(body.data.error, this.token) : null;
      throw new KnowledgeApiError(kindForStatus(res.status), res.status, detail, tool, res.status === 429 ? retryAfterMs(res.headers.get("retry-after")) : null);
    }
    const parsed = KnowledgeResultSchema.safeParse(json);
    if (!parsed.success) throw new KnowledgeApiError("bad_response", res.status, null, tool);
    return parsed.data;
  }
}

function kindForStatus(status: number): KnowledgeErrorKind {
  if (status === 400 || status === 422) return "bad_request";
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server";
  return "bad_response";
}

function retryAfterMs(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds * 1000) : null;
}

/** Remove the token (and its 8-char prefix) from API text, collapse whitespace and truncate. */
function sanitize(message: string, token: string): string | null {
  let m = message.split(token).join("[redacted]");
  if (token.length >= 8) m = m.split(token.slice(0, 8)).join("[redacted]");
  m = m.replace(/\s+/g, " ").trim();
  return m.length > MAX_DETAIL ? `${m.slice(0, MAX_DETAIL)}…` : m || null;
}

/** Message for the AI client. Never contains the token or the knowledge URL. */
export function knowledgeErrorMessage(err: KnowledgeApiError): string {
  switch (err.kind) {
    case "bad_request":
      return `The knowledge base rejected the request: ${err.detail ?? "invalid input"}. Fix that field and try again.`;
    case "unauthorized":
      return "The knowledge base did not accept this server's token. Ask whoever runs this MCP server to check BOLD_KNOWLEDGE_TOKEN.";
    case "not_found":
      return "The knowledge base is switched off or doesn't offer this tool. Ask whoever runs this MCP server to check BOLD_KNOWLEDGE_URL and the sales assistant's knowledge API.";
    case "rate_limited":
      return `The knowledge base is busy (too many questions a minute). Try again${err.retryAfterMs ? ` in ${Math.ceil(err.retryAfterMs / 1000)} seconds` : " shortly"}.`;
    case "timeout":
      return "The knowledge base took too long to answer. Try again, or ask a narrower question.";
    case "server":
    case "network":
      return "The knowledge base is unavailable right now. Try again shortly.";
    case "bad_response":
      return "The knowledge base returned a response this server could not read. Try again; if it persists, contact support.";
  }
}
