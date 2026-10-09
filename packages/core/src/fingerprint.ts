import { createHash } from "node:crypto";

/**
 * Key fingerprint used in logs, metrics and support: the first 12 hex
 * characters of the key's SHA-256. Safe to log; the key itself never is.
 */
export function keyFingerprint(apiKey: string): string {
  return createHash("sha256").update(apiKey, "utf8").digest("hex").slice(0, 12);
}
