import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Key-encryption key (KEK) provider. Production uses a cloud KMS (adapter
 * added when the hosting account exists); `LocalKms` is the stand-in for
 * development, tests and staging without a KMS.
 */
export interface Kms {
  readonly keyId: string;
  wrap(dek: Buffer): Promise<Buffer>;
  unwrap(wrapped: Buffer): Promise<Buffer>;
}

/** AES-256-GCM key wrapping with a master key from the environment. Not for production. */
export class LocalKms implements Kms {
  readonly keyId: string;
  private readonly master: Buffer;

  constructor(masterKeyBase64: string, keyId = "local-1") {
    const key = Buffer.from(masterKeyBase64, "base64");
    if (key.length !== 32) throw new Error("BOLD_LOCAL_KMS_KEY must be 32 bytes, base64-encoded");
    this.master = key;
    this.keyId = keyId;
  }

  async wrap(dek: Buffer): Promise<Buffer> {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", this.master, iv);
    const ct = Buffer.concat([c.update(dek), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), ct]);
  }

  async unwrap(wrapped: Buffer): Promise<Buffer> {
    const iv = wrapped.subarray(0, 12);
    const tag = wrapped.subarray(12, 28);
    const d = createDecipheriv("aes-256-gcm", this.master, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(wrapped.subarray(28)), d.final()]);
  }
}
