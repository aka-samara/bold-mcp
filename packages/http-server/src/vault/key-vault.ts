import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { Kms } from "./kms.js";

/** Stored form of an API key: AES-256-GCM with a per-key data key wrapped by the KMS. */
export interface EncryptedKey {
  v: 1;
  alg: "AES-256-GCM";
  kek_id: string;
  wrapped_dek: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

export class KmsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KmsError";
  }
}

/**
 * Envelope encryption for stored API keys (brief: "AES-256-GCM envelope
 * encryption with a KMS-managed key; decrypted only in memory for each API
 * call"). The connection id is bound in as associated data, so a ciphertext
 * cannot be moved to another connection.
 */
export class KeyVault {
  constructor(private readonly kms: Kms) {}

  async encrypt(apiKey: string, connectionId: string): Promise<EncryptedKey> {
    const dek = randomBytes(32);
    try {
      const iv = randomBytes(12);
      const c = createCipheriv("aes-256-gcm", dek, iv);
      c.setAAD(Buffer.from(connectionId, "utf8"));
      const ciphertext = Buffer.concat([c.update(apiKey, "utf8"), c.final()]);
      let wrapped: Buffer;
      try {
        wrapped = await this.kms.wrap(dek);
      } catch {
        throw new KmsError("KMS wrap failed");
      }
      return {
        v: 1,
        alg: "AES-256-GCM",
        kek_id: this.kms.keyId,
        wrapped_dek: wrapped.toString("base64"),
        iv: iv.toString("base64"),
        tag: c.getAuthTag().toString("base64"),
        ciphertext: ciphertext.toString("base64"),
      };
    } finally {
      dek.fill(0);
    }
  }

  async decrypt(enc: EncryptedKey, connectionId: string): Promise<string> {
    let dek: Buffer;
    try {
      dek = await this.kms.unwrap(Buffer.from(enc.wrapped_dek, "base64"));
    } catch {
      throw new KmsError("KMS unwrap failed");
    }
    try {
      const d = createDecipheriv("aes-256-gcm", dek, Buffer.from(enc.iv, "base64"));
      d.setAAD(Buffer.from(connectionId, "utf8"));
      d.setAuthTag(Buffer.from(enc.tag, "base64"));
      return Buffer.concat([d.update(Buffer.from(enc.ciphertext, "base64")), d.final()]).toString("utf8");
    } finally {
      dek.fill(0);
    }
  }
}
