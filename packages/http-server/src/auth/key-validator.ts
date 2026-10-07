import { keyFingerprint, PartnerApiError, type PartnerApiClient } from "@bold-mcp/core";

export type KeyValidity = "valid" | "invalid" | "unknown";

export interface KeyValidityCache {
  get(fingerprint: string): Promise<KeyValidity | undefined>;
  set(fingerprint: string, value: KeyValidity, ttlMs: number): Promise<void>;
}

export class MemoryKeyValidityCache implements KeyValidityCache {
  private readonly map = new Map<string, { value: KeyValidity; expires: number }>();
  constructor(private readonly now: () => number = Date.now) {}
  async get(fp: string) {
    const e = this.map.get(fp);
    if (!e) return undefined;
    if (e.expires <= this.now()) {
      this.map.delete(fp);
      return undefined;
    }
    return e.value;
  }
  async set(fp: string, value: KeyValidity, ttlMs: number) {
    if (this.map.size > 50_000) this.map.clear();
    this.map.set(fp, { value, expires: this.now() + ttlMs });
  }
}

/**
 * Header mode: check a key with the free Credit Usage endpoint and cache the
 * answer by fingerprint. Nothing about the key is stored. A temporary API
 * failure gives "unknown" (cached briefly), and tool calls go ahead.
 */
export class KeyValidator {
  constructor(
    private readonly client: PartnerApiClient,
    private readonly cache: KeyValidityCache,
    private readonly ttlMs: number,
  ) {}

  async check(apiKey: string): Promise<{ fingerprint: string; status: KeyValidity }> {
    const fingerprint = keyFingerprint(apiKey);
    const cached = await this.cache.get(fingerprint);
    if (cached) return { fingerprint, status: cached };
    let status: KeyValidity;
    try {
      await this.client.call("credit-usage", {}, apiKey);
      status = "valid";
    } catch (err) {
      status = err instanceof PartnerApiError && err.kind === "unauthorized" ? "invalid" : "unknown";
    }
    await this.cache.set(fingerprint, status, status === "unknown" ? Math.min(this.ttlMs, 30_000) : this.ttlMs);
    return { fingerprint, status };
  }
}
