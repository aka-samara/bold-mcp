/**
 * Local rate limits. The in-memory store is the default (stdio, tests, a
 * single instance); the HTTP server swaps in a Redis store behind the same
 * interface when several instances run.
 */

export interface RateWindow {
  name: string;
  windowMs: number;
  limit: number;
}

export type ConsumeResult = { allowed: true } | { allowed: false; window: string; retryAfterMs: number };

export interface RateLimitStore {
  /** Count one hit against every window, or none if any window is full. */
  consume(key: string, windows: readonly RateWindow[], now?: number): Promise<ConsumeResult>;
}

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
/** Calendar months vary; a 30-day window is the conservative stand-in. */
export const MONTH = 30 * DAY;

export class MemoryRateLimitStore implements RateLimitStore {
  private readonly counts = new Map<string, { n: number; resetAt: number }>();

  async consume(key: string, windows: readonly RateWindow[], now = Date.now()): Promise<ConsumeResult> {
    this.prune(now);
    const slots = windows.map((w) => {
      const start = Math.floor(now / w.windowMs) * w.windowMs;
      const id = `${key}|${w.name}|${start}`;
      return { w, id, resetAt: start + w.windowMs, n: this.counts.get(id)?.n ?? 0 };
    });
    const full = slots.find((s) => s.n >= s.w.limit);
    if (full) return { allowed: false, window: full.w.name, retryAfterMs: full.resetAt - now };
    for (const s of slots) this.counts.set(s.id, { n: s.n + 1, resetAt: s.resetAt });
    return { allowed: true };
  }

  private prune(now: number): void {
    if (this.counts.size < 10_000) return;
    for (const [id, v] of this.counts) if (v.resetAt <= now) this.counts.delete(id);
  }
}

/** Per-connection concurrency cap (brief: 5 concurrent tool calls). */
export class ConcurrencyLimiter {
  private readonly active = new Map<string, number>();
  constructor(private readonly max: number) {}

  tryAcquire(key: string): (() => void) | null {
    const n = this.active.get(key) ?? 0;
    if (n >= this.max) return null;
    this.active.set(key, n + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const left = (this.active.get(key) ?? 1) - 1;
      if (left <= 0) this.active.delete(key);
      else this.active.set(key, left);
    };
  }
}

/** Per connection (or key fingerprint in header mode): 60 tool calls per minute. */
export const CONNECTION_WINDOWS: readonly RateWindow[] = [{ name: "minute", windowMs: MINUTE, limit: 60 }];
export const CONNECTION_CONCURRENCY = 5;

/** Documented upstream limits, enforced per key before calling the API. */
export const UPSTREAM_WINDOWS = {
  "company-search-free": [
    { name: "minute", windowMs: MINUTE, limit: 30 },
    { name: "hour", windowMs: HOUR, limit: 450 },
    { name: "day", windowMs: DAY, limit: 1500 },
  ],
  "company-contacts": [
    { name: "minute", windowMs: MINUTE, limit: 10 },
    { name: "hour", windowMs: HOUR, limit: 150 },
    { name: "month", windowMs: MONTH, limit: 25_000 },
  ],
  "advanced-company-contacts": [
    { name: "minute", windowMs: MINUTE, limit: 75 },
    { name: "hour", windowMs: HOUR, limit: 500 },
    { name: "month", windowMs: MONTH, limit: 150_000 },
  ],
} as const satisfies Record<string, readonly RateWindow[]>;

export class LocalRateLimitError extends Error {
  constructor(
    public readonly scope: "connection" | "concurrency" | keyof typeof UPSTREAM_WINDOWS,
    public readonly window: string,
    public readonly retryAfterMs: number,
  ) {
    super(`Local rate limit reached: ${scope} per ${window}`);
    this.name = "LocalRateLimitError";
  }
}

export function formatWait(ms: number): string {
  const s = Math.ceil(ms / 1000);
  if (s < 90) return `${s} second${s === 1 ? "" : "s"}`;
  const m = Math.ceil(s / 60);
  if (m < 90) return `${m} minutes`;
  const h = Math.ceil(m / 60);
  return h < 48 ? `${h} hours` : `${Math.ceil(h / 24)} days`;
}
