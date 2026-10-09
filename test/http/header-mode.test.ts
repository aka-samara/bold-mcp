import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { setupServer } from "msw/node";
import { createPartnerApiMock } from "../msw/handlers.ts";
import { BAD_KEY, FAKE_KEY } from "../helpers/harness.ts";
import { INIT_BODY, startHttp } from "../helpers/http.ts";

const mock = createPartnerApiMock(undefined, { invalidKeys: [BAD_KEY] });
const msw = setupServer(...mock.handlers);
let h: Awaited<ReturnType<typeof startHttp>>;

beforeAll(async () => {
  msw.listen({ onUnhandledFrame: "bypass" });
  h = await startHttp();
});
afterEach(() => mock.reset());
afterAll(async () => {
  await h.stop();
  msw.close();
});

const post = (headers: Record<string, string>, body: unknown = INIT_BODY, path = "/mcp") =>
  fetch(`${h.url}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify(body),
  });

describe("/mcp authentication", () => {
  it("answers 401 with the RFC 9728 challenge when no key is sent", async () => {
    const res = await post({});
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe(
      'Bearer resource_metadata="https://mcp.test.example/.well-known/oauth-protected-resource", scope="bold"',
    );
  });

  it("refuses a key in the URL", async () => {
    for (const q of ["apikey", "api_key", "key", "token"]) {
      const res = await post({ authorization: `Bearer ${FAKE_KEY}` }, INIT_BODY, `/mcp?${q}=${FAKE_KEY}`);
      expect(res.status, q).toBe(400);
      expect(await res.text()).not.toContain(FAKE_KEY);
    }
  });

  it("rejects a disallowed browser Origin", async () => {
    const res = await post({ authorization: `Bearer ${FAKE_KEY}`, origin: "https://evil.example" });
    expect(res.status).toBe(403);
  });

  it("allows claude.ai and chatgpt.com origins", async () => {
    for (const origin of ["https://claude.ai", "https://chatgpt.com"]) {
      const res = await post({ authorization: `Bearer ${FAKE_KEY}`, origin });
      expect(res.status, origin).toBe(200);
    }
  });

  it("treats boldmcp_ bearer values as OAuth tokens (not recognised before M3)", async () => {
    const res = await post({ authorization: "Bearer boldmcp_notarealtoken" });
    expect(res.status).toBe(401);
    expect(mock.calls).toHaveLength(0);
  });

  it("rejects a malformed Authorization header", async () => {
    const res = await post({ authorization: "Basic abc" });
    expect(res.status).toBe(401);
  });
});

describe("header mode end to end", () => {
  it.each([
    ["Authorization: Bearer", { authorization: `Bearer ${FAKE_KEY}` }],
    ["api-key", { "api-key": FAKE_KEY }],
  ])("works with %s", async (_label, headers) => {
    const { client } = await h.connect(headers);
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThanOrEqual(9);
    const r = await client.callTool({ name: "get_credit_balance", arguments: {} });
    expect(r.isError).toBeFalsy();
    expect(mock.calls.every((c) => c.hasApiKey)).toBe(true);
    await client.close();
  });

  it("validates a new key once and caches it by fingerprint", async () => {
    const { client } = await h.connect({ authorization: `Bearer ${FAKE_KEY}` });
    await client.callTool({ name: "get_market_insights", arguments: { type: "imp", hs_codes: ["940360"] } });
    await client.close();
    // The key was validated earlier in this file, so no extra credit-usage call is made.
    expect(mock.calls.filter((c) => c.path === "credit-usage")).toHaveLength(0);
  });

  it("an unrecognised key connects but tools return the brief's error", async () => {
    const { client } = await h.connect({ authorization: `Bearer ${BAD_KEY}` });
    const r = (await client.callTool({ name: "get_credit_balance", arguments: {} })) as { isError?: boolean; content: { text: string }[] };
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toBe("API key not recognised — check the key in your client settings.");
    await client.close();
  });

  it("binds sessions to the key that created them", async () => {
    const { client, transport } = await h.connect({ authorization: `Bearer ${FAKE_KEY}` });
    const sessionId = transport.sessionId as string;
    const other = await post({ authorization: `Bearer ${BAD_KEY}`, "mcp-session-id": sessionId, "mcp-protocol-version": "2025-06-18" }, { jsonrpc: "2.0", id: 2, method: "tools/list" });
    expect(other.status).toBe(404);
    await client.close();
  });

  it("returns 404 for an unknown session and 400 for a non-initialize request without one", async () => {
    const a = await post({ authorization: `Bearer ${FAKE_KEY}`, "mcp-session-id": "nope" }, { jsonrpc: "2.0", id: 2, method: "tools/list" });
    expect(a.status).toBe(404);
    const b = await post({ authorization: `Bearer ${FAKE_KEY}` }, { jsonrpc: "2.0", id: 2, method: "tools/list" });
    expect(b.status).toBe(400);
  });

  it("serves /healthz", async () => {
    const res = await fetch(`${h.url}/healthz`);
    expect(await res.json()).toMatchObject({ ok: true });
  });
});
