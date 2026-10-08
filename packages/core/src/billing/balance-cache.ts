import type { Balances } from "../shaping/credits.js";

/** Pool balances per key fingerprint, cached for 60 seconds (brief). Redis replaces the memory store in M3. */
export interface BalanceCache {
  get(fingerprint: string): Promise<Balances | undefined>;
  set(fingerprint: string, balances: Balances, ttlMs: number): Promise<void>;
  delete(fingerprint: string): Promise<void>;
}

export const BALANCE_TTL_MS = 60_000;

export class MemoryBalanceCache implements BalanceCache {
  private readonly map = new Map<string, { balances: Balances; expires: number }>();
  constructor(private readonly now: () => number = Date.now) {}

  async get(fp: string) {
    const e = this.map.get(fp);
    if (!e) return undefined;
    if (e.expires <= this.now()) {
      this.map.delete(fp);
      return undefined;
    }
    return e.balances;
  }

  async set(fp: string, balances: Balances, ttlMs: number) {
    if (this.map.size > 50_000) this.map.clear();
    this.map.set(fp, { balances, expires: this.now() + ttlMs });
  }

  async delete(fp: string) {
    this.map.delete(fp);
  }
}
