import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import pg from "pg";
import type { SpendingSettings, ToolCallLog, UnlockAuditEntry } from "@bold-mcp/core";
import type { EncryptedKey } from "../vault/key-vault.js";
import type { Connection, Db, OAuthClient, TokenRecord } from "./types.js";

const MIGRATIONS = fileURLToPath(new URL("./migrations/", import.meta.url));

/** Apply pending migrations in order, each in a transaction. */
export async function migrate(pool: pg.Pool, dir = MIGRATIONS): Promise<string[]> {
  await pool.query("CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  const done = new Set((await pool.query<{ version: string }>("SELECT version FROM schema_migrations")).rows.map((r) => r.version));
  const applied: string[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(file)) continue;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(readFileSync(join(dir, file), "utf8"));
      await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [file]);
      await client.query("COMMIT");
      applied.push(file);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
  return applied;
}

type ConnRow = {
  id: string;
  encrypted_key: EncryptedKey;
  key_fingerprint: string;
  client_id: string;
  client_name: string | null;
  per_call_limit: number;
  daily_limit: number;
  allow_contact_unlocks: boolean;
  allow_kyb_unlocks: boolean;
  created_at: Date;
  last_used_at: Date;
  invalid_at: Date | null;
  revoked_at: Date | null;
};

const toConnection = (r: ConnRow): Connection => ({
  id: r.id,
  encryptedKey: r.encrypted_key,
  keyFingerprint: r.key_fingerprint,
  clientId: r.client_id,
  clientName: r.client_name,
  settings: {
    perCallLimit: r.per_call_limit,
    dailyLimit: r.daily_limit,
    allowContactUnlocks: r.allow_contact_unlocks,
    allowKybUnlocks: r.allow_kyb_unlocks,
  } satisfies SpendingSettings,
  createdAt: r.created_at,
  lastUsedAt: r.last_used_at,
  invalidAt: r.invalid_at,
  revokedAt: r.revoked_at,
});

type TokenRow = { token_hash: string; kind: "access" | "refresh"; connection_id: string; client_id: string; resource: string; family_id: string; expires_at: Date; used_at: Date | null };

export class PostgresDb implements Db {
  constructor(readonly pool: pg.Pool) {}

  static fromUrl(url: string): PostgresDb {
    return new PostgresDb(new pg.Pool({ connectionString: url, max: 10, idleTimeoutMillis: 30_000 }));
  }

  clients = {
    get: async (id: string): Promise<OAuthClient | undefined> => {
      const r = await this.pool.query<{ id: string; kind: "dcr" | "cimd"; client_name: string | null; redirect_uris: string[]; metadata: Record<string, unknown> }>(
        "SELECT id, kind, client_name, redirect_uris, metadata FROM oauth_clients WHERE id = $1",
        [id],
      );
      const row = r.rows[0];
      return row ? { id: row.id, kind: row.kind, clientName: row.client_name, redirectUris: row.redirect_uris, metadata: row.metadata } : undefined;
    },
    upsert: async (c: OAuthClient) => {
      await this.pool.query(
        `INSERT INTO oauth_clients (id, kind, client_name, redirect_uris, metadata) VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (id) DO UPDATE SET client_name = EXCLUDED.client_name, redirect_uris = EXCLUDED.redirect_uris, metadata = EXCLUDED.metadata`,
        [c.id, c.kind, c.clientName, c.redirectUris, c.metadata],
      );
    },
  };

  connections = {
    create: async (c: Omit<Connection, "createdAt" | "lastUsedAt" | "invalidAt" | "revokedAt">): Promise<Connection> => {
      const r = await this.pool.query<ConnRow>(
        `INSERT INTO connections (id, encrypted_key, key_fingerprint, client_id, client_name, per_call_limit, daily_limit, allow_contact_unlocks, allow_kyb_unlocks)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
        [c.id, c.encryptedKey, c.keyFingerprint, c.clientId, c.clientName, c.settings.perCallLimit, c.settings.dailyLimit, c.settings.allowContactUnlocks, c.settings.allowKybUnlocks],
      );
      return toConnection(r.rows[0] as ConnRow);
    },
    get: async (id: string) => {
      const r = await this.pool.query<ConnRow>("SELECT * FROM connections WHERE id = $1", [id]);
      return r.rows[0] ? toConnection(r.rows[0]) : undefined;
    },
    touch: async (id: string) => {
      // Throttled: at most one write a minute per connection.
      await this.pool.query("UPDATE connections SET last_used_at = now() WHERE id = $1 AND last_used_at < now() - interval '1 minute'", [id]);
    },
    markInvalid: async (id: string) => {
      await this.pool.query("UPDATE connections SET invalid_at = now() WHERE id = $1 AND invalid_at IS NULL", [id]);
    },
    revoke: async (id: string, reason: string) => {
      await this.pool.query("UPDATE connections SET revoked_at = now(), revoked_reason = $2 WHERE id = $1 AND revoked_at IS NULL", [id, reason]);
    },
    revokeByFingerprint: async (fp: string, reason: string) => {
      const r = await this.pool.query("UPDATE connections SET revoked_at = now(), revoked_reason = $2 WHERE key_fingerprint = $1 AND revoked_at IS NULL", [fp, reason]);
      return r.rowCount ?? 0;
    },
    expireUnused: async (olderThan: Date) => {
      const r = await this.pool.query("UPDATE connections SET revoked_at = now(), revoked_reason = 'unused 90 days' WHERE revoked_at IS NULL AND last_used_at < $1", [olderThan]);
      return r.rowCount ?? 0;
    },
  };

  tokens = {
    create: async (t: Omit<TokenRecord, "usedAt">) => {
      await this.pool.query(
        "INSERT INTO oauth_tokens (token_hash, kind, connection_id, client_id, resource, family_id, expires_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
        [t.tokenHash, t.kind, t.connectionId, t.clientId, t.resource, t.familyId, t.expiresAt],
      );
    },
    get: async (h: string): Promise<TokenRecord | undefined> => {
      const r = await this.pool.query<TokenRow>("SELECT * FROM oauth_tokens WHERE token_hash = $1", [h]);
      const row = r.rows[0];
      return row
        ? { tokenHash: row.token_hash, kind: row.kind, connectionId: row.connection_id, clientId: row.client_id, resource: row.resource, familyId: row.family_id, expiresAt: row.expires_at, usedAt: row.used_at }
        : undefined;
    },
    markUsed: async (h: string) => {
      const r = await this.pool.query("UPDATE oauth_tokens SET used_at = now() WHERE token_hash = $1 AND used_at IS NULL", [h]);
      return (r.rowCount ?? 0) === 1;
    },
  };

  usage = {
    record: async (e: ToolCallLog) => {
      await this.pool.query(
        `INSERT INTO usage_log (connection_id, key_fingerprint, auth_mode, tool, pool, credits_estimated, credits_used, outcome, latency_ms)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [e.connection_id, e.key_fp, e.auth_mode, e.tool, e.pool, e.credits_estimated, e.credits_used ?? null, e.outcome, e.latency_ms],
      );
    },
  };

  audit = {
    record: async (e: UnlockAuditEntry) => {
      await this.pool.query(
        `INSERT INTO unlock_audit (created_at, connection_id, key_fingerprint, tool, subject_type, subject_id, unlocked, credits_used)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [e.at, e.connection_id, e.key_fp, e.tool, e.subject_type, e.subject_id, e.unlocked, e.credits_used],
      );
    },
    list: async (f: { keyFingerprint?: string; subjectId?: string; limit?: number }): Promise<UnlockAuditEntry[]> => {
      const r = await this.pool.query<{ created_at: Date; connection_id: string | null; key_fingerprint: string; tool: string; subject_type: "contact" | "kyb"; subject_id: string; unlocked: string[]; credits_used: number }>(
        `SELECT * FROM unlock_audit WHERE ($1::text IS NULL OR key_fingerprint = $1) AND ($2::text IS NULL OR subject_id = $2) ORDER BY id DESC LIMIT $3`,
        [f.keyFingerprint ?? null, f.subjectId ?? null, f.limit ?? 100],
      );
      return r.rows.map((x) => ({ at: x.created_at.toISOString(), connection_id: x.connection_id, key_fp: x.key_fingerprint, tool: x.tool, subject_type: x.subject_type, subject_id: x.subject_id, unlocked: x.unlocked, credits_used: x.credits_used }));
    },
  };

  async close() {
    await this.pool.end();
  }
}
