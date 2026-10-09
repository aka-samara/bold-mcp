import { describe, expect, it } from "vitest";
import { ConcurrencyLimiter, formatWait, MemoryRateLimitStore, MINUTE, UPSTREAM_WINDOWS } from "@bold-mcp/core";

describe("MemoryRateLimitStore", () => {
  it("allows up to the limit then blocks with retry-after", async () => {
    const s = new MemoryRateLimitStore();
    const w = [{ name: "minute", windowMs: MINUTE, limit: 3 }];
    const t = 1_000_000 * MINUTE + 10_000;
    for (let i = 0; i < 3; i++) expect((await s.consume("k", w, t)).allowed).toBe(true);
    const r = await s.consume("k", w, t);
    expect(r).toEqual({ allowed: false, window: "minute", retryAfterMs: 50_000 });
    expect((await s.consume("k", w, t + 50_000)).allowed).toBe(true);
  });

  it("does not count a blocked hit against other windows", async () => {
    const s = new MemoryRateLimitStore();
    const windows = UPSTREAM_WINDOWS["company-contacts"];
    const t = 5 * 24 * 3600_000;
    for (let i = 0; i < 10; i++) await s.consume("k", windows, t);
    expect((await s.consume("k", windows, t)).allowed).toBe(false);
    // Next minute: hour window has 10, not 11.
    for (let i = 0; i < 10; i++) expect((await s.consume("k", windows, t + MINUTE)).allowed).toBe(true);
  });

  it("keeps keys separate", async () => {
    const s = new MemoryRateLimitStore();
    const w = [{ name: "m", windowMs: MINUTE, limit: 1 }];
    expect((await s.consume("a", w, 0)).allowed).toBe(true);
    expect((await s.consume("b", w, 0)).allowed).toBe(true);
  });
});

describe("ConcurrencyLimiter", () => {
  it("caps concurrent holders and releases once", () => {
    const c = new ConcurrencyLimiter(2);
    const r1 = c.tryAcquire("k");
    const r2 = c.tryAcquire("k");
    expect(c.tryAcquire("k")).toBeNull();
    r1?.();
    r1?.();
    expect(c.tryAcquire("k")).not.toBeNull();
    expect(c.tryAcquire("k")).toBeNull();
    r2?.();
  });
});

it("formats waits in words", () => {
  expect(formatWait(1000)).toBe("1 second");
  expect(formatWait(30 * MINUTE)).toBe("30 minutes");
  expect(formatWait(3 * 24 * 60 * MINUTE)).toBe("3 days");
});
