import { describe, expect, it } from "vitest";
import { KeyVault, KmsError } from "../../packages/http-server/src/vault/key-vault.ts";
import { LocalKms, type Kms } from "../../packages/http-server/src/vault/kms.ts";
import { CimdFetcher, isCimdClientId, isPrivateAddress } from "../../packages/http-server/src/oauth/cimd.ts";
import { isAcceptableRedirect, redirectMatches } from "../../packages/http-server/src/oauth/redirects.ts";
import { Csrf } from "../../packages/http-server/src/oauth/csrf.ts";
import { FAKE_KEY } from "../helpers/harness.ts";

const kms = new LocalKms(Buffer.alloc(32, 9).toString("base64"));

describe("KeyVault", () => {
  it("round-trips a key and never stores it in plaintext", async () => {
    const v = new KeyVault(kms);
    const enc = await v.encrypt(FAKE_KEY, "conn-1");
    expect(JSON.stringify(enc)).not.toContain(FAKE_KEY);
    expect(enc).toMatchObject({ v: 1, alg: "AES-256-GCM", kek_id: "local-1" });
    expect(await v.decrypt(enc, "conn-1")).toBe(FAKE_KEY);
  });

  it("binds the ciphertext to its connection id", async () => {
    const v = new KeyVault(kms);
    const enc = await v.encrypt(FAKE_KEY, "conn-1");
    await expect(v.decrypt(enc, "conn-2")).rejects.toThrow();
  });

  it("detects tampering", async () => {
    const v = new KeyVault(kms);
    const enc = await v.encrypt(FAKE_KEY, "conn-1");
    const ct = Buffer.from(enc.ciphertext, "base64");
    ct[0] = (ct[0] ?? 0) ^ 1;
    await expect(v.decrypt({ ...enc, ciphertext: ct.toString("base64") }, "conn-1")).rejects.toThrow();
  });

  it("reports KMS outages as KmsError without the key", async () => {
    const down: Kms = { keyId: "x", wrap: () => Promise.reject(new Error("down")), unwrap: () => Promise.reject(new Error("down")) };
    const err = await new KeyVault(down).encrypt(FAKE_KEY, "c").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(KmsError);
    expect(String(err)).not.toContain(FAKE_KEY);
  });

  it("refuses a master key of the wrong length", () => {
    expect(() => new LocalKms(Buffer.alloc(16).toString("base64"))).toThrow(/32 bytes/);
  });
});

describe("redirect URIs", () => {
  it("accepts https and loopback http only", () => {
    expect(isAcceptableRedirect("https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(isAcceptableRedirect("http://localhost:6274/cb")).toBe(true);
    expect(isAcceptableRedirect("http://[::1]:1/cb")).toBe(true);
    expect(isAcceptableRedirect("http://example.com/cb")).toBe(false);
    expect(isAcceptableRedirect("https://u:p@example.com/cb")).toBe(false);
    expect(isAcceptableRedirect("javascript:alert(1)")).toBe(false);
  });

  it("matches exactly, except loopback ports", () => {
    expect(redirectMatches("https://a.example/cb", ["https://a.example/cb"])).toBe(true);
    expect(redirectMatches("https://a.example/cb2", ["https://a.example/cb"])).toBe(false);
    expect(redirectMatches("https://a.example:8443/cb", ["https://a.example/cb"])).toBe(false);
    expect(redirectMatches("http://127.0.0.1:5555/cb", ["http://127.0.0.1:1234/cb"])).toBe(true);
    expect(redirectMatches("http://127.0.0.1:5555/other", ["http://127.0.0.1:1234/cb"])).toBe(false);
    expect(redirectMatches("http://localhost:5555/cb", ["http://127.0.0.1:1234/cb"])).toBe(false);
  });
});

describe("CSRF tokens", () => {
  it("verify only with the matching cookie, request and age", () => {
    let now = 1_000_000;
    const c = new Csrf("secret", () => now);
    const nonce = c.newNonce();
    const t = c.token(nonce, "req-a");
    expect(c.verify(t, nonce, "req-a")).toBe(true);
    expect(c.verify(t, nonce, "req-b")).toBe(false);
    expect(c.verify(t, c.newNonce(), "req-a")).toBe(false);
    expect(c.verify(undefined, nonce, "req-a")).toBe(false);
    now += 31 * 60_000;
    expect(c.verify(t, nonce, "req-a")).toBe(false);
  });
});

describe("CIMD client metadata", () => {
  const ID = "https://app.example/oauth/client.json";
  const doc = (over: Record<string, unknown> = {}) => JSON.stringify({ client_id: ID, client_name: "Example", redirect_uris: ["https://app.example/cb"], ...over });
  const fetcher = (body: string, opts: { addresses?: string[]; status?: number } = {}) =>
    new CimdFetcher({
      resolve: async () => opts.addresses ?? ["93.184.216.34"],
      fetchImpl: (async () => new Response(body, { status: opts.status ?? 200, headers: { "content-type": "application/json" } })) as never,
    });

  it("recognises HTTPS URL client ids with a path", () => {
    expect(isCimdClientId(ID)).toBe(true);
    expect(isCimdClientId("https://app.example/")).toBe(false);
    expect(isCimdClientId("http://app.example/c.json")).toBe(false);
    expect(isCimdClientId("bold_client_x")).toBe(false);
  });

  it("loads a valid document", async () => {
    expect(await fetcher(doc()).fetch(ID)).toMatchObject({ id: ID, kind: "cimd", clientName: "Example", redirectUris: ["https://app.example/cb"] });
  });

  it("refuses private and loopback hosts (SSRF)", async () => {
    for (const ip of ["127.0.0.1", "10.0.0.5", "192.168.1.1", "169.254.169.254", "::1", "fd00::1", "100.64.0.1", "::ffff:127.0.0.1"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
      await expect(fetcher(doc(), { addresses: [ip] }).fetch(ID), ip).rejects.toThrow(/private/);
    }
    expect(isPrivateAddress("93.184.216.34")).toBe(false);
  });

  it("refuses mismatched ids, confidential clients, bad redirects, oversize and errors", async () => {
    await expect(fetcher(doc({ client_id: "https://evil.example/c.json" })).fetch(ID)).rejects.toThrow(/does not match/);
    await expect(fetcher(doc({ token_endpoint_auth_method: "private_key_jwt" })).fetch(ID)).rejects.toThrow(/public clients/);
    await expect(fetcher(doc({ redirect_uris: ["http://app.example/cb"] })).fetch(ID)).rejects.toThrow(/redirect_uri/);
    await expect(fetcher("x".repeat(70_000)).fetch(ID)).rejects.toThrow(/too large/);
    await expect(fetcher("not json").fetch(ID)).rejects.toThrow(/not valid/);
    await expect(fetcher(doc(), { status: 404 }).fetch(ID)).rejects.toThrow(/HTTP 404/);
  });
});
