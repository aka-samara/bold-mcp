import type { ToolCallLog, UnlockAuditEntry } from "@bold-mcp/core";
import type { Connection, Db, OAuthClient, TokenRecord } from "./types.js";

/** In-memory Db for tests and local runs without Postgres. */
export class MemoryDb implements Db {
  readonly clientRows = new Map<string, OAuthClient>();
  readonly connectionRows = new Map<string, Connection>();
  readonly tokenRows = new Map<string, TokenRecord>();
  readonly usageRows: ToolCallLog[] = [];
  readonly auditRows: UnlockAuditEntry[] = [];

  constructor(private readonly now: () => Date = () => new Date()) {}

  clients = {
    get: async (id: string) => this.clientRows.get(id),
    upsert: async (c: OAuthClient) => void this.clientRows.set(c.id, structuredClone(c)),
  };

  connections = {
    create: async (c: Omit<Connection, "createdAt" | "lastUsedAt" | "invalidAt" | "revokedAt">) => {
      const row: Connection = { ...structuredClone(c), createdAt: this.now(), lastUsedAt: this.now(), invalidAt: null, revokedAt: null };
      this.connectionRows.set(c.id, row);
      return structuredClone(row);
    },
    get: async (id: string) => {
      const r = this.connectionRows.get(id);
      return r ? structuredClone(r) : undefined;
    },
    touch: async (id: string) => {
      const r = this.connectionRows.get(id);
      if (r) r.lastUsedAt = this.now();
    },
    markInvalid: async (id: string) => {
      const r = this.connectionRows.get(id);
      if (r && !r.invalidAt) r.invalidAt = this.now();
    },
    revoke: async (id: string) => {
      const r = this.connectionRows.get(id);
      if (r && !r.revokedAt) r.revokedAt = this.now();
    },
    revokeByFingerprint: async (fp: string) => {
      let n = 0;
      for (const r of this.connectionRows.values()) {
        if (r.keyFingerprint === fp && !r.revokedAt) {
          r.revokedAt = this.now();
          n++;
        }
      }
      return n;
    },
    expireUnused: async (olderThan: Date) => {
      let n = 0;
      for (const r of this.connectionRows.values()) {
        if (!r.revokedAt && r.lastUsedAt < olderThan) {
          r.revokedAt = this.now();
          n++;
        }
      }
      return n;
    },
  };

  tokens = {
    create: async (t: Omit<TokenRecord, "usedAt">) => void this.tokenRows.set(t.tokenHash, { ...t, usedAt: null }),
    get: async (h: string) => {
      const t = this.tokenRows.get(h);
      return t ? { ...t } : undefined;
    },
    markUsed: async (h: string) => {
      const t = this.tokenRows.get(h);
      if (!t || t.usedAt) return false;
      t.usedAt = this.now();
      return true;
    },
  };

  usage = {
    record: async (e: ToolCallLog) => void this.usageRows.push(e),
  };

  audit = {
    record: async (e: UnlockAuditEntry) => void this.auditRows.push(structuredClone(e)),
    list: async (f: { keyFingerprint?: string; subjectId?: string; limit?: number }) =>
      this.auditRows
        .filter((e) => (!f.keyFingerprint || e.key_fp === f.keyFingerprint) && (!f.subjectId || e.subject_id === f.subjectId))
        .reverse()
        .slice(0, f.limit ?? 100),
  };

  async close() {}
}
