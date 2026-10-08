import { createHash, randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";

/**
 * Confirmation tokens (brief: signed, single-use, bound to the connection,
 * tool and exact arguments, valid for 10 minutes, stored in Redis).
 * The token is an HS256 JWT; its id (jti) is kept in a store until used.
 */

export const CONFIRMATION_TTL_MS = 10 * 60_000;
const ISSUER = "bold-mcp";
const AUDIENCE = "bold-mcp:confirm";

export interface ConfirmationStore {
  /** Remember a token id until it expires. */
  put(jti: string, ttlMs: number): Promise<void>;
  /** Atomically remove a token id; true if it was present (i.e. unused and unexpired). */
  take(jti: string): Promise<boolean>;
}

export class MemoryConfirmationStore implements ConfirmationStore {
  private readonly map = new Map<string, number>();
  constructor(private readonly now: () => number = Date.now) {}
  async put(jti: string, ttlMs: number) {
    for (const [k, exp] of this.map) if (exp <= this.now()) this.map.delete(k);
    this.map.set(jti, this.now() + ttlMs);
  }
  async take(jti: string) {
    const exp = this.map.get(jti);
    this.map.delete(jti);
    return exp !== undefined && exp > this.now();
  }
}

/** Stable JSON: sorted keys, `confirmation_token` excluded. */
export function canonicalArgs(args: Record<string, unknown>): string {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === "object")
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>)
          .filter(([k, x]) => k !== "confirmation_token" && x !== undefined)
          .sort(([a], [b]) => (a < b ? -1 : 1))
          .map(([k, x]) => [k, norm(x)]),
      );
    return v;
  };
  return JSON.stringify(norm(args));
}

export function argsHash(args: Record<string, unknown>): string {
  return createHash("sha256").update(canonicalArgs(args)).digest("base64url");
}

export type VerifyResult = { ok: true } | { ok: false; reason: "invalid" | "expired" | "used" | "mismatch" };

export class ConfirmationTokens {
  private readonly secret: Uint8Array;

  constructor(
    secret: string | Uint8Array,
    private readonly store: ConfirmationStore,
    private readonly now: () => number = Date.now,
  ) {
    this.secret = typeof secret === "string" ? new TextEncoder().encode(secret) : secret;
    if (this.secret.length < 32) throw new Error("Confirmation token secret must be at least 32 bytes");
  }

  static randomSecret(): Uint8Array {
    return new Uint8Array(randomBytes(32));
  }

  async issue(binding: string, tool: string, args: Record<string, unknown>): Promise<{ token: string; expiresAt: string }> {
    const jti = randomBytes(16).toString("base64url");
    const iat = Math.floor(this.now() / 1000);
    const exp = iat + CONFIRMATION_TTL_MS / 1000;
    const token = await new SignJWT({ tool, args: argsHash(args) })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setSubject(binding)
      .setJti(jti)
      .setIssuedAt(iat)
      .setExpirationTime(exp)
      .sign(this.secret);
    await this.store.put(jti, CONFIRMATION_TTL_MS);
    return { token, expiresAt: new Date(exp * 1000).toISOString() };
  }

  /** Check and consume. A token is used up only when it matches this connection, tool and arguments. */
  async verify(token: string, binding: string, tool: string, args: Record<string, unknown>): Promise<VerifyResult> {
    let payload;
    try {
      ({ payload } = await jwtVerify(token, this.secret, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ["HS256"],
        currentDate: new Date(this.now()),
      }));
    } catch (err) {
      return { ok: false, reason: err instanceof Error && err.name === "JWTExpired" ? "expired" : "invalid" };
    }
    if (payload.sub !== binding || payload.tool !== tool || payload.args !== argsHash(args)) return { ok: false, reason: "mismatch" };
    if (!payload.jti || !(await this.store.take(payload.jti))) return { ok: false, reason: "used" };
    return { ok: true };
  }
}
