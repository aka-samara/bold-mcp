import { describe, expect, it } from "vitest";
import { ConfigError, DEFAULT_API_BASE_URL, keyFingerprint, loadCoreConfig, readApiKey } from "@bold-mcp/core";

const FAKE_KEY = "00000000-test-fake-key-0000000000000";

describe("loadCoreConfig", () => {
  it("defaults the base URL and timeout", () => {
    const c = loadCoreConfig({});
    expect(c.BOLD_API_BASE_URL).toBe(DEFAULT_API_BASE_URL);
    expect(c.BOLD_API_TIMEOUT_MS).toBe(25_000);
  });

  it("treats a blank base URL as unset and strips trailing slashes", () => {
    expect(loadCoreConfig({ BOLD_API_BASE_URL: "  " }).BOLD_API_BASE_URL).toBe(DEFAULT_API_BASE_URL);
    expect(loadCoreConfig({ BOLD_API_BASE_URL: "https://staging.example/partner-api/" }).BOLD_API_BASE_URL).toBe(
      "https://staging.example/partner-api",
    );
  });

  it("rejects a base URL that is not http(s) or carries a query string", () => {
    expect(() => loadCoreConfig({ BOLD_API_BASE_URL: "ftp://x.example" })).toThrow(ConfigError);
    expect(() => loadCoreConfig({ BOLD_API_BASE_URL: "https://x.example/api?apikey=abc" })).toThrow(ConfigError);
  });

  it("never echoes a bad value in the error", () => {
    const secretish = "https://x.example/?apikey=SHOULD-NOT-APPEAR";
    try {
      loadCoreConfig({ BOLD_API_BASE_URL: secretish });
      expect.unreachable();
    } catch (err) {
      expect(String((err as Error).message)).not.toContain("SHOULD-NOT-APPEAR");
    }
  });

  it("rejects an out-of-range timeout", () => {
    expect(() => loadCoreConfig({ BOLD_API_TIMEOUT_MS: "5" })).toThrow(ConfigError);
  });
});

describe("readApiKey", () => {
  it("returns the first non-empty variable", () => {
    expect(readApiKey(["A", "B"], { A: "", B: FAKE_KEY })).toBe(FAKE_KEY);
    expect(readApiKey(["A"], {})).toBeUndefined();
  });

  it("rejects malformed keys without echoing them", () => {
    try {
      readApiKey(["BOLD_API_KEY"], { BOLD_API_KEY: "short key" });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as Error).message).toContain("BOLD_API_KEY");
      expect((err as Error).message).not.toContain("short key");
    }
  });
});

describe("keyFingerprint", () => {
  it("is the first 12 hex chars of SHA-256 and never contains the key", () => {
    const fp = keyFingerprint(FAKE_KEY);
    expect(fp).toMatch(/^[0-9a-f]{12}$/);
    expect(FAKE_KEY).not.toContain(fp);
    expect(keyFingerprint(FAKE_KEY)).toBe(fp);
  });
});
