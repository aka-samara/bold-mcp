/** Short-lived, single-use values (OAuth authorization codes). */
export interface EphemeralStore {
  set(key: string, value: string, ttlMs: number): Promise<void>;
  /** Get and delete atomically; null if missing or expired. */
  take(key: string): Promise<string | null>;
}

export class MemoryEphemeralStore implements EphemeralStore {
  private readonly map = new Map<string, { value: string; expires: number }>();
  constructor(private readonly now: () => number = Date.now) {}
  async set(key: string, value: string, ttlMs: number) {
    for (const [k, v] of this.map) if (v.expires <= this.now()) this.map.delete(k);
    this.map.set(key, { value, expires: this.now() + ttlMs });
  }
  async take(key: string) {
    const v = this.map.get(key);
    this.map.delete(key);
    return v && v.expires > this.now() ? v.value : null;
  }
}
