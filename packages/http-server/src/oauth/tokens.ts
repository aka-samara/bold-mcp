import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Db, TokenRecord } from "../db/types.js";

export const TOKEN_PREFIX = "boldmcp_";
export const ACCESS_TTL_MS = 60 * 60_000; // 1 hour
export const REFRESH_TTL_MS = 90 * 24 * 60 * 60_000; // 90 days

/** Opaque 256-bit random token with the `boldmcp_` prefix. */
export function newToken(): string {
  return `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export interface IssuedTokens {
  access_token: string;
  refresh_token: string;
  token_type: "Bearer";
  expires_in: number;
  scope: "bold";
}

/** Access and refresh tokens: only SHA-256 hashes are stored. */
export class TokenService {
  constructor(
    private readonly db: Db,
    private readonly now: () => number = Date.now,
  ) {}

  async issue(connectionId: string, clientId: string, resource: string, familyId: string = randomUUID()): Promise<IssuedTokens> {
    const access = newToken();
    const refresh = newToken();
    const now = this.now();
    await this.db.tokens.create({ tokenHash: hashToken(access), kind: "access", connectionId, clientId, resource, familyId, expiresAt: new Date(now + ACCESS_TTL_MS) });
    await this.db.tokens.create({ tokenHash: hashToken(refresh), kind: "refresh", connectionId, clientId, resource, familyId, expiresAt: new Date(now + REFRESH_TTL_MS) });
    return { access_token: access, refresh_token: refresh, token_type: "Bearer", expires_in: ACCESS_TTL_MS / 1000, scope: "bold" };
  }

  /** A live access token for this resource, or undefined. */
  async checkAccess(token: string, resource: string): Promise<TokenRecord | undefined> {
    const t = await this.db.tokens.get(hashToken(token));
    if (!t || t.kind !== "access" || t.resource !== resource || t.expiresAt.getTime() <= this.now()) return undefined;
    return t;
  }

  /**
   * Rotate a refresh token. Re-use of an already-rotated token revokes the
   * whole connection (brief). Returns undefined for any dead token.
   */
  async rotate(token: string, clientId: string): Promise<{ record: TokenRecord; reused: boolean } | undefined> {
    const t = await this.db.tokens.get(hashToken(token));
    if (!t || t.kind !== "refresh" || t.clientId !== clientId) return undefined;
    if (t.usedAt) return { record: t, reused: true };
    if (t.expiresAt.getTime() <= this.now()) return undefined;
    const first = await this.db.tokens.markUsed(t.tokenHash);
    return { record: t, reused: !first };
  }
}
