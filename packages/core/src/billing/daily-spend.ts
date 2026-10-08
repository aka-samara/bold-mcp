/**
 * Credits spent per connection (or key fingerprint in header mode) per UTC
 * day, all pools together, from the server's estimates. Postgres usage_log
 * replaces the memory store in M3.
 */
export interface DailySpendStore {
  get(binding: string, day: string): Promise<number>;
  add(binding: string, day: string, credits: number): Promise<void>;
}

export function utcDay(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

export class MemoryDailySpendStore implements DailySpendStore {
  private readonly map = new Map<string, number>();
  async get(binding: string, day: string) {
    return this.map.get(`${binding}|${day}`) ?? 0;
  }
  async add(binding: string, day: string, credits: number) {
    const k = `${binding}|${day}`;
    if (this.map.size > 100_000) this.map.clear();
    this.map.set(k, (this.map.get(k) ?? 0) + credits);
  }
}
