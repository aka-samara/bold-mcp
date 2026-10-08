import { Redis } from "ioredis";
import type { BalanceCache, Balances, ConfirmationStore, ConsumeResult, DailySpendStore, RateLimitStore, RateWindow } from "@bold-mcp/core";
import type { KeyValidity, KeyValidityCache } from "../auth/key-validator.js";
import type { EphemeralStore } from "./ephemeral.js";

/**
 * Redis implementations of the state the brief puts in Redis: confirmation
 * tokens, rate limits, balance cache, key-validity cache, plus daily spend
 * and one-time OAuth codes. Keys are namespaced under `bold:`.
 */

// Check every window, then count one hit in each, atomically.
const CONSUME_LUA = `
local now = tonumber(ARGV[1])
local n = (#ARGV - 1) / 3
for i = 0, n - 1 do
  local name = ARGV[2 + i * 3]
  local windowMs = tonumber(ARGV[3 + i * 3])
  local limit = tonumber(ARGV[4 + i * 3])
  local start = math.floor(now / windowMs) * windowMs
  local key = KEYS[1] .. '|' .. name .. '|' .. start
  local count = tonumber(redis.call('GET', key) or '0')
  if count >= limit then
    return {0, name, start + windowMs - now}
  end
end
for i = 0, n - 1 do
  local name = ARGV[2 + i * 3]
  local windowMs = tonumber(ARGV[3 + i * 3])
  local start = math.floor(now / windowMs) * windowMs
  local key = KEYS[1] .. '|' .. name .. '|' .. start
  redis.call('INCR', key)
  redis.call('PEXPIRE', key, windowMs)
end
return {1, '', 0}
`;

export class RedisRateLimitStore implements RateLimitStore {
  constructor(private readonly redis: Redis) {}
  async consume(key: string, windows: readonly RateWindow[], now = Date.now()): Promise<ConsumeResult> {
    const args = [String(now), ...windows.flatMap((w) => [w.name, String(w.windowMs), String(w.limit)])];
    const [ok, name, retry] = (await this.redis.eval(CONSUME_LUA, 1, `bold:rl:${key}`, ...args)) as [number, string, number];
    return ok === 1 ? { allowed: true } : { allowed: false, window: name, retryAfterMs: Number(retry) };
  }
}

export class RedisConfirmationStore implements ConfirmationStore {
  constructor(private readonly redis: Redis) {}
  async put(jti: string, ttlMs: number) {
    await this.redis.set(`bold:confirm:${jti}`, "1", "PX", ttlMs);
  }
  async take(jti: string) {
    return (await this.redis.getdel(`bold:confirm:${jti}`)) !== null;
  }
}

export class RedisBalanceCache implements BalanceCache {
  constructor(private readonly redis: Redis) {}
  async get(fp: string) {
    const v = await this.redis.get(`bold:bal:${fp}`);
    return v ? (JSON.parse(v) as Balances) : undefined;
  }
  async set(fp: string, balances: Balances, ttlMs: number) {
    await this.redis.set(`bold:bal:${fp}`, JSON.stringify(balances), "PX", ttlMs);
  }
  async delete(fp: string) {
    await this.redis.del(`bold:bal:${fp}`);
  }
}

export class RedisKeyValidityCache implements KeyValidityCache {
  constructor(private readonly redis: Redis) {}
  async get(fp: string) {
    return ((await this.redis.get(`bold:keyok:${fp}`)) as KeyValidity | null) ?? undefined;
  }
  async set(fp: string, value: KeyValidity, ttlMs: number) {
    await this.redis.set(`bold:keyok:${fp}`, value, "PX", ttlMs);
  }
}

export class RedisDailySpendStore implements DailySpendStore {
  constructor(private readonly redis: Redis) {}
  async get(binding: string, day: string) {
    return Number((await this.redis.get(`bold:spend:${binding}:${day}`)) ?? 0);
  }
  async add(binding: string, day: string, credits: number) {
    const k = `bold:spend:${binding}:${day}`;
    await this.redis.multi().incrby(k, Math.round(credits)).pexpire(k, 2 * 86_400_000).exec();
  }
}

export class RedisEphemeralStore implements EphemeralStore {
  constructor(private readonly redis: Redis) {}
  async set(key: string, value: string, ttlMs: number) {
    await this.redis.set(`bold:eph:${key}`, value, "PX", ttlMs);
  }
  async take(key: string) {
    return this.redis.getdel(`bold:eph:${key}`);
  }
}
