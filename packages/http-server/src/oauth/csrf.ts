import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Connect-page CSRF: a random nonce in an HttpOnly cookie, and a form token
 * that is an HMAC of that nonce, the authorization request and the time.
 */

export const CSRF_COOKIE = "bold_csrf";
export const CSRF_MAX_AGE_MS = 30 * 60_000;

export class Csrf {
  private readonly secret: Buffer;
  constructor(secret: string | Uint8Array, private readonly now: () => number = Date.now) {
    this.secret = Buffer.from(secret);
  }

  newNonce(): string {
    return randomBytes(16).toString("base64url");
  }

  private mac(nonce: string, bindTo: string, issued: number): string {
    return createHmac("sha256", this.secret).update(`${nonce}|${issued}|${bindTo}`).digest("base64url");
  }

  token(nonce: string, bindTo: string): string {
    const issued = this.now();
    return `${issued}.${this.mac(nonce, bindTo, issued)}`;
  }

  verify(token: string | undefined, nonce: string | undefined, bindTo: string): boolean {
    if (!token || !nonce) return false;
    const [issuedRaw, mac] = token.split(".");
    const issued = Number(issuedRaw);
    if (!mac || !Number.isFinite(issued) || this.now() - issued > CSRF_MAX_AGE_MS || issued > this.now() + 60_000) return false;
    const expected = Buffer.from(this.mac(nonce, bindTo, issued));
    const got = Buffer.from(mac);
    return expected.length === got.length && timingSafeEqual(expected, got);
  }
}
