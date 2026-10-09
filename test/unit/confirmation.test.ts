import { describe, expect, it } from "vitest";
import { argsHash, canonicalArgs, ConfirmationTokens, MemoryConfirmationStore } from "@bold-mcp/core";

function tokens(clock = { t: Date.UTC(2026, 9, 8) }) {
  const now = () => clock.t;
  return { t: new ConfirmationTokens("x".repeat(32), new MemoryConfirmationStore(now), now), clock };
}

const args = { hs_codes: ["9403"], page_size: 20 };

describe("confirmation tokens", () => {
  it("verify once, then refuse reuse", async () => {
    const { t } = tokens();
    const { token } = await t.issue("conn1", "list_importers", args);
    expect(await t.verify(token, "conn1", "list_importers", { ...args, confirmation_token: token })).toEqual({ ok: true });
    expect(await t.verify(token, "conn1", "list_importers", args)).toEqual({ ok: false, reason: "used" });
  });

  it("is bound to the connection, tool and exact arguments", async () => {
    const { t } = tokens();
    const { token } = await t.issue("conn1", "list_importers", args);
    expect((await t.verify(token, "conn2", "list_importers", args)).ok).toBe(false);
    expect((await t.verify(token, "conn1", "list_exporters", args)).ok).toBe(false);
    expect((await t.verify(token, "conn1", "list_importers", { ...args, page_size: 21 })).ok).toBe(false);
    // A mismatch does not burn the token.
    expect(await t.verify(token, "conn1", "list_importers", args)).toEqual({ ok: true });
  });

  it("expires after 10 minutes", async () => {
    const { t, clock } = tokens();
    const { token, expiresAt } = await t.issue("c", "search_kyb", {});
    expect(Date.parse(expiresAt) - clock.t).toBe(600_000);
    clock.t += 600_001;
    expect(await t.verify(token, "c", "search_kyb", {})).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects tampered or foreign tokens", async () => {
    const { t } = tokens();
    const { token } = await t.issue("c", "search_kyb", {});
    expect((await t.verify(`${token}x`, "c", "search_kyb", {})).ok).toBe(false);
    const other = new ConfirmationTokens("y".repeat(32), new MemoryConfirmationStore());
    const { token: foreign } = await other.issue("c", "search_kyb", {});
    expect(await t.verify(foreign, "c", "search_kyb", {})).toEqual({ ok: false, reason: "invalid" });
  });

  it("needs a 32-byte secret", () => {
    expect(() => new ConfirmationTokens("short", new MemoryConfirmationStore())).toThrow();
  });

  it("hashes arguments canonically", () => {
    expect(canonicalArgs({ b: 1, a: { d: 1, c: 2 }, confirmation_token: "x" })).toBe('{"a":{"c":2,"d":1},"b":1}');
    expect(argsHash({ a: 1, b: 2 })).toBe(argsHash({ b: 2, a: 1 }));
  });
});
