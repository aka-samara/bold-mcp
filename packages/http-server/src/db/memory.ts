import type { ToolCallLog, UnlockAuditEntry } from "@bold-mcp/core";
import type { Connection, Db, OAuthClient, TokenRecord, UsageSummary } from "./types.js";

/** In-memory Db for tests and local runs without Postgres. */
export class MemoryDb implements Db {
  readonly clientRows = new Map<string, OAuthClient>();
  readonly connectionRows = new Map<string, Connection>();
  readonly tokenRows = new Map<string, TokenRecord>();
  readonly usageRows: (ToolCallLog & { at: Date })[] = [];
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
    sampleActive: async (since: Date, limit: number) =>
      [...this.connectionRows.values()].filter((r) => !r.revokedAt && !r.invalidAt && r.lastUsedAt >= since).slice(0, limit),
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
    record: async (e: ToolCallLog) => void this.usageRows.push({ ...e, at: this.now() }),
    creditsByPool: async (fp: string, since: Date) => {
      const out = { data: 0, contact: 0, kyb: 0 };
      for (const r of this.usageRows) if (r.key_fp === fp && r.at >= since && r.pool && r.credits_used) out[r.pool as keyof typeof out] += r.credits_used;
      return out;
    },
    heavySpenders: async (since: Date, min: number) => {
      const by = new Map<string, number>();
      for (const r of this.usageRows) if (r.at >= since && r.credits_used) by.set(r.key_fp, (by.get(r.key_fp) ?? 0) + r.credits_used);
      return [...by].filter(([, c]) => c > min).map(([key_fp, credits]) => ({ key_fp, credits })).sort((a, b) => b.credits - a.credits);
    },
    summary: async (since: Date): Promise<UsageSummary> => {
      const rows = this.usageRows.filter((r) => r.at >= since);
      const credits_by_pool = { data: 0, contact: 0, kyb: 0 };
      const tools = new Map<string, { calls: number; credits: number }>();
      const failures = new Map<string, { tool: string; outcome: string; error_kind: string | null; count: number }>();
      for (const r of rows) {
        if (r.pool && r.credits_used) credits_by_pool[r.pool as keyof typeof credits_by_pool] += r.credits_used;
        const t = tools.get(r.tool) ?? { calls: 0, credits: 0 };
        t.calls++;
        t.credits += r.credits_used ?? 0;
        tools.set(r.tool, t);
        if (r.outcome !== "ok" && r.outcome !== "confirmation_required") {
          const k = `${r.tool}|${r.outcome}|${r.error_kind ?? ""}`;
          const f = failures.get(k) ?? { tool: r.tool, outcome: r.outcome, error_kind: r.error_kind ?? null, count: 0 };
          f.count++;
          failures.set(k, f);
        }
      }
      return {
        since: since.toISOString(),
        tool_calls: rows.length,
        active_keys: new Set(rows.map((r) => r.key_fp)).size,
        new_connections: [...this.connectionRows.values()].filter((c) => c.createdAt >= since).length,
        credits_by_pool,
        top_tools: [...tools].map(([tool, v]) => ({ tool, ...v })).sort((a, b) => b.calls - a.calls).slice(0, 10),
        top_failures: [...failures.values()].sort((a, b) => b.count - a.count).slice(0, 10),
      };
    },
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
