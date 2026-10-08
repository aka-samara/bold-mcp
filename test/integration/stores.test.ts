// Storage contract tests. MemoryDb always runs; Postgres and Redis run when
// TEST_DATABASE_URL / TEST_REDIS_URL are set (CI service containers, or local
// `docker compose up -d`).
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { Redis } from "ioredis";
import type { Balances } from "@bold-mcp/core";
import { MemoryDb } from "../../packages/http-server/src/db/memory.ts";
import { migrate, PostgresDb } from "../../packages/http-server/src/db/postgres.ts";
import type { Db } from "../../packages/http-server/src/db/types.ts";
import { KeyVault } from "../../packages/http-server/src/vault/key-vault.ts";
import { LocalKms } from "../../packages/http-server/src/vault/kms.ts";
import { TokenService } from "../../packages/http-server/src/oauth/tokens.ts";
import {
  RedisBalanceCache,
  RedisConfirmationStore,
  RedisDailySpendStore,
  RedisEphemeralStore,
  RedisKeyValidityCache,
  RedisRateLimitStore,
} from "../../packages/http-server/src/state/redis.ts";
import { FAKE_KEY } from "../helpers/harness.ts";

const vault = new KeyVault(new LocalKms(Buffer.alloc(32, 3).toString("base64")));
const SETTINGS = { perCallLimit: 150, dailyLimit: 2000, allowContactUnlocks: false, allowKybUnlocks: true };

function dbContract(name: string, makeDb: () => Promise<Db>) {
  describe(`Db contract: ${name}`, () => {
    let db: Db;
    beforeAll(async () => {
      db = await makeDb();
    });
    afterAll(async () => db.close());

    async function newConnection(fp = "fp" + randomUUID().slice(0, 10)) {
      const id = randomUUID();
      await db.clients.upsert({ id: "client-" + id, kind: "dcr", clientName: "Test", redirectUris: ["https://c.example/cb"], metadata: {} });
      return db.connections.create({ id, encryptedKey: await vault.encrypt(FAKE_KEY, id), keyFingerprint: fp, clientId: "client-" + id, clientName: "Test", settings: SETTINGS });
    }

    it("stores and reads clients", async () => {
      await db.clients.upsert({ id: "c1", kind: "cimd", clientName: "A", redirectUris: ["https://a.example/cb"], metadata: { x: 1 } });
      await db.clients.upsert({ id: "c1", kind: "cimd", clientName: "B", redirectUris: ["https://b.example/cb"], metadata: {} });
      expect(await db.clients.get("c1")).toMatchObject({ clientName: "B", redirectUris: ["https://b.example/cb"] });
      expect(await db.clients.get("nope")).toBeUndefined();
    });

    it("round-trips a connection with its encrypted key and settings", async () => {
      const c = await newConnection();
      const got = await db.connections.get(c.id);
      expect(got?.settings).toEqual(SETTINGS);
      expect(await vault.decrypt(got?.encryptedKey as never, c.id)).toBe(FAKE_KEY);
      expect(got?.revokedAt).toBeNull();
      expect(got?.invalidAt).toBeNull();
    });

    it("marks invalid, revokes, and revokes by fingerprint", async () => {
      const a = await newConnection();
      await db.connections.markInvalid(a.id);
      expect((await db.connections.get(a.id))?.invalidAt).toBeInstanceOf(Date);
      await db.connections.revoke(a.id, "test");
      expect((await db.connections.get(a.id))?.revokedAt).toBeInstanceOf(Date);
      const fp = "fp-shared-" + randomUUID().slice(0, 6);
      await newConnection(fp);
      await newConnection(fp);
      expect(await db.connections.revokeByFingerprint(fp, "test")).toBe(2);
      expect(await db.connections.revokeByFingerprint(fp, "test")).toBe(0);
    });

    it("expires connections unused since a date", async () => {
      const c = await newConnection();
      expect(await db.connections.expireUnused(new Date(Date.now() - 60_000))).toBe(0);
      expect(await db.connections.expireUnused(new Date(Date.now() + 60_000))).toBeGreaterThanOrEqual(1);
      expect((await db.connections.get(c.id))?.revokedAt).toBeInstanceOf(Date);
    });

    it("issues, checks and rotates tokens; reuse is detected once", async () => {
      const c = await newConnection();
      const ts = new TokenService(db);
      const t = await ts.issue(c.id, c.clientId, "https://r.example/mcp");
      expect((await ts.checkAccess(t.access_token, "https://r.example/mcp"))?.connectionId).toBe(c.id);
      expect(await ts.checkAccess(t.access_token, "https://other.example/mcp")).toBeUndefined();
      expect(await ts.checkAccess(t.refresh_token, "https://r.example/mcp")).toBeUndefined();
      const [r1, r2] = await Promise.all([ts.rotate(t.refresh_token, c.clientId), ts.rotate(t.refresh_token, c.clientId)]);
      // Two concurrent uses: exactly one wins, the other counts as reuse.
      expect([r1?.reused, r2?.reused].sort()).toEqual([false, true]);
      expect(await ts.rotate(t.refresh_token, "another-client")).toBeUndefined();
    });

    it("stores no token in plaintext", async () => {
      const c = await newConnection();
      const t = await new TokenService(db).issue(c.id, c.clientId, "https://r.example/mcp");
      expect(await db.tokens.get(t.access_token)).toBeUndefined();
    });

    it("records and lists unlock audit entries, newest first", async () => {
      const fp = "fp-audit-" + randomUUID().slice(0, 6);
      const base = { tool: "reveal_contact_details", connection_id: null, key_fp: fp, subject_type: "contact" as const, unlocked: ["phones"], credits_used: 15 };
      await db.audit.record({ ...base, subject_id: "ct-1", at: new Date(Date.now() - 1000).toISOString() });
      await db.audit.record({ ...base, subject_id: "ct-2", at: new Date().toISOString() });
      const rows = await db.audit.list({ keyFingerprint: fp });
      expect(rows.map((r) => r.subject_id)).toEqual(["ct-2", "ct-1"]);
      expect(rows[0]).toMatchObject({ unlocked: ["phones"], credits_used: 15, subject_type: "contact" });
      expect(await db.audit.list({ subjectId: "ct-1", keyFingerprint: fp })).toHaveLength(1);
    });

    it("records usage log entries", async () => {
      await db.usage.record({ tool: "get_credit_balance", connection_id: null, key_fp: "abc", auth_mode: "header", pool: null, credits_estimated: 0, latency_ms: 12, outcome: "ok" });
    });
  });
}

dbContract("memory", async () => new MemoryDb());

const PG = process.env.TEST_DATABASE_URL;
const pgSchema = `t_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
describe.runIf(Boolean(PG))("Postgres", () => {
  let admin: pg.Pool;
  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: PG });
    await admin.query(`CREATE SCHEMA ${pgSchema}`);
  });
  afterAll(async () => {
    await admin.query(`DROP SCHEMA ${pgSchema} CASCADE`);
    await admin.end();
  });

  const url = () => {
    const u = new URL(PG as string);
    u.searchParams.set("options", `-c search_path=${pgSchema}`);
    return u.toString();
  };

  it("applies migrations once", async () => {
    const db = PostgresDb.fromUrl(url());
    expect(await migrate(db.pool)).toEqual(["001_init.sql", "002_unlock_audit.sql", "003_usage_error_kind.sql"]);
    expect(await migrate(db.pool)).toEqual([]);
    await db.close();
  });

  dbContract("postgres", async () => {
    const db = PostgresDb.fromUrl(url());
    await migrate(db.pool);
    return db;
  });

  it("never stores the API key in plaintext", async () => {
    const db = PostgresDb.fromUrl(url());
    await migrate(db.pool);
    const id = randomUUID();
    await db.clients.upsert({ id: "c-" + id, kind: "dcr", clientName: null, redirectUris: ["https://c.example/cb"], metadata: {} });
    await db.connections.create({ id, encryptedKey: await vault.encrypt(FAKE_KEY, id), keyFingerprint: "fp", clientId: "c-" + id, clientName: null, settings: SETTINGS });
    const dump = JSON.stringify((await db.pool.query("SELECT * FROM connections")).rows);
    expect(dump).not.toContain(FAKE_KEY);
    await db.close();
  });
});

const REDIS = process.env.TEST_REDIS_URL;
describe.runIf(Boolean(REDIS))("Redis stores", () => {
  let redis: Redis;
  const p = `t${randomUUID().slice(0, 8)}:`;
  beforeAll(() => {
    redis = new Redis(REDIS as string, { keyPrefix: p });
  });
  afterAll(async () => {
    const keys = await new Redis(REDIS as string).keys(`${p}*`);
    if (keys.length) await new Redis(REDIS as string).del(...keys);
    redis.disconnect();
  });

  it("rate limits across windows atomically", async () => {
    const s = new RedisRateLimitStore(redis);
    const windows = [{ name: "minute", windowMs: 60_000, limit: 3 }];
    const now = Date.UTC(2026, 0, 1, 12, 0, 10);
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => s.consume("k", windows, now)));
    expect(results.filter((r) => r.allowed)).toHaveLength(3);
    const denied = results.find((r) => !r.allowed);
    expect(denied && !denied.allowed && denied.retryAfterMs).toBe(50_000);
    expect((await s.consume("k", windows, now + 60_000)).allowed).toBe(true);
  });

  it("confirmation ids are single-use", async () => {
    const s = new RedisConfirmationStore(redis);
    await s.put("jti1", 10_000);
    const [a, b] = await Promise.all([s.take("jti1"), s.take("jti1")]);
    expect([a, b].sort()).toEqual([false, true]);
  });

  it("caches balances, key validity and daily spend", async () => {
    const balances = { data: { total: 1, used: 0, remaining: 1 }, contact: { total: 0, used: 0, remaining: 0 }, kyb: { total: 0, used: 0, remaining: 0 } } as unknown as Balances;
    const b = new RedisBalanceCache(redis);
    await b.set("fp", balances, 10_000);
    expect(await b.get("fp")).toEqual(balances);
    await b.delete("fp");
    expect(await b.get("fp")).toBeUndefined();
    const k = new RedisKeyValidityCache(redis);
    await k.set("fp", "valid", 10_000);
    expect(await k.get("fp")).toBe("valid");
    const d = new RedisDailySpendStore(redis);
    await d.add("conn", "2026-01-01", 5);
    await d.add("conn", "2026-01-01", 7);
    expect(await d.get("conn", "2026-01-01")).toBe(12);
    expect(await d.get("conn", "2026-01-02")).toBe(0);
  });

  it("ephemeral values are taken once and expire", async () => {
    const e = new RedisEphemeralStore(redis);
    await e.set("code", "v", 10_000);
    expect(await e.take("code")).toBe("v");
    expect(await e.take("code")).toBeNull();
    await e.set("short", "v", 1);
    await new Promise((r) => setTimeout(r, 20));
    expect(await e.take("short")).toBeNull();
  });
});
