import type { SpendingSettings, ToolCallLog, UnlockAuditEntry } from "@bold-mcp/core";
import type { EncryptedKey } from "../vault/key-vault.js";

export interface OAuthClient {
  id: string;
  kind: "dcr" | "cimd";
  clientName: string | null;
  redirectUris: string[];
  metadata: Record<string, unknown>;
}

export interface Connection {
  id: string;
  encryptedKey: EncryptedKey;
  keyFingerprint: string;
  clientId: string;
  clientName: string | null;
  settings: SpendingSettings;
  createdAt: Date;
  lastUsedAt: Date;
  invalidAt: Date | null;
  revokedAt: Date | null;
}

export interface TokenRecord {
  tokenHash: string;
  kind: "access" | "refresh";
  connectionId: string;
  clientId: string;
  resource: string;
  familyId: string;
  expiresAt: Date;
  usedAt: Date | null;
}

/** Persistence for the sign-in. Postgres in staging/production; memory for tests and local runs. */
export interface Db {
  clients: {
    get(id: string): Promise<OAuthClient | undefined>;
    upsert(client: OAuthClient): Promise<void>;
  };
  connections: {
    create(c: Omit<Connection, "createdAt" | "lastUsedAt" | "invalidAt" | "revokedAt">): Promise<Connection>;
    get(id: string): Promise<Connection | undefined>;
    touch(id: string): Promise<void>;
    markInvalid(id: string): Promise<void>;
    revoke(id: string, reason: string): Promise<void>;
    revokeByFingerprint(fingerprint: string, reason: string): Promise<number>;
    expireUnused(olderThan: Date): Promise<number>;
  };
  tokens: {
    create(t: Omit<TokenRecord, "usedAt">): Promise<void>;
    get(tokenHash: string): Promise<TokenRecord | undefined>;
    /** Mark a refresh token used; returns false if it was already used (reuse). */
    markUsed(tokenHash: string): Promise<boolean>;
  };
  usage: {
    record(entry: ToolCallLog): Promise<void>;
  };
  audit: {
    record(entry: UnlockAuditEntry): Promise<void>;
    /** Newest first, for operators answering a data-subject or customer request. */
    list(filter: { keyFingerprint?: string; subjectId?: string; limit?: number }): Promise<UnlockAuditEntry[]>;
  };
  close(): Promise<void>;
}
