// Admin CLI against Postgres and the local mock Partner API. Needs TEST_DATABASE_URL and a build.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { keyFingerprint } from "@bold-mcp/core";
import { migrate, PostgresDb } from "../../packages/http-server/src/db/postgres.ts";
import { KeyVault } from "../../packages/http-server/src/vault/key-vault.ts";
import { LocalKms } from "../../packages/http-server/src/vault/kms.ts";

const run = promisify(execFile);
const PG = process.env.TEST_DATABASE_URL;
const ADMIN = "packages/http-server/dist/admin.js";
const schema = `t_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
const KMS_KEY = Buffer.alloc(32, 5).toString("base64");
const KEY = "mock-admin-test-key-0000000000000";

describe.runIf(Boolean(PG) && existsSync(ADMIN))("admin CLI", () => {
  let admin: pg.Pool;
  let url: string;
  let mock: { close(): void; address(): { port: number } };
  let base: string;
  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: PG });
    await admin.query(`CREATE SCHEMA ${schema}`);
    const u = new URL(PG as string);
    u.searchParams.set("options", `-c search_path=${schema}`);
    url = u.toString();
    // @ts-expect-error -- plain JS helper without type declarations
    const { startMock } = (await import("../../scripts/mock-partner-api.mjs")) as { startMock(port: number): Promise<typeof mock> };
    mock = await startMock(0);
    base = `http://127.0.0.1:${mock.address().port}/partner-api`;
  });
  afterAll(async () => {
    mock?.close();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });

  const cli = (...args: string[]) =>
    run("node", [ADMIN, ...args], { env: { ...process.env, DATABASE_URL: url, REDIS_URL: "", BOLD_API_BASE_URL: base, BOLD_LOCAL_KMS_KEY: KMS_KEY, NODE_ENV: "development" } });

  it("migrates, reports and reconciles a connection's spend against Credit Usage Logs", async () => {
    expect((await cli("migrate")).stdout).toMatch(/Applied|Up to date/);
    const db = PostgresDb.fromUrl(url);
    await migrate(db.pool);
    const id = randomUUID();
    const fp = keyFingerprint(KEY);
    await db.clients.upsert({ id: "c-" + id, kind: "dcr", clientName: null, redirectUris: ["https://c.example/cb"], metadata: {} });
    await db.connections.create({ id, encryptedKey: await new KeyVault(new LocalKms(KMS_KEY)).encrypt(KEY, id), keyFingerprint: fp, clientId: "c-" + id, clientName: null, settings: { perCallLimit: 150, dailyLimit: 2000, allowContactUnlocks: true, allowKybUnlocks: true } });
    // The server estimated 15 data credits; the mock API has charged nothing for this key yet.
    await db.usage.record({ tool: "list_importers", connection_id: id, key_fp: fp, auth_mode: "oauth", pool: "data", credits_estimated: 30, credits_used: 15, latency_ms: 50, outcome: "ok" });
    await db.close();

    const report = JSON.parse((await cli("report", "--days", "1")).stdout) as { tool_calls: number; credits_by_pool: { data: number } };
    expect(report).toMatchObject({ tool_calls: 1, credits_by_pool: { data: 15 } });

    expect((await cli("spend-check", "--hours", "1", "--limit", "5000")).stdout).toContain("0 key(s) above 5000");
    const heavy = await cli("spend-check", "--hours", "1", "--limit", "10").catch((e: { code: number; stdout: string }) => e);
    expect((heavy as { code?: number }).code).toBe(1);
    expect(heavy.stdout).toContain(`"key_fp":"${fp}","credits":15`);

    const r = await cli("reconcile", "--hours", "1").catch((e: { code: number; stdout: string }) => e);
    expect((r as { code?: number }).code).toBe(1);
    expect(r.stdout).toContain('"pool":"data","mcp_estimated":15,"api_logged":0,"ok":false');
    expect(r.stdout).not.toContain(KEY);
  });
});
