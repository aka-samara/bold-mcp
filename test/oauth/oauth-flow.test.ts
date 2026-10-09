import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupServer } from "msw/node";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { DEFAULT_API_BASE_URL } from "@bold-mcp/core";
import { createPartnerApiMock } from "../msw/handlers.ts";
import { loadFixtures } from "../fixtures/load.ts";
import { BAD_KEY, FAKE_KEY } from "../helpers/harness.ts";
import { INIT_BODY, startHttp } from "../helpers/http.ts";
import { authorizeParams, form, openConnectPage, pkce, PUBLIC_URL, REDIRECT, register, RESOURCE, signIn, submitKey } from "../helpers/oauth.ts";
import { LocalKms, type Kms } from "../../packages/http-server/src/vault/kms.ts";
import { CimdFetcher } from "../../packages/http-server/src/oauth/cimd.ts";

const mock = createPartnerApiMock(undefined, { invalidKeys: [BAD_KEY] });
const msw = setupServer(...mock.handlers);
/** Every header and body sent to the Partner API, to prove tokens never reach it. */
const outbound: string[] = [];

/** KMS stand-in that can be switched off to simulate an outage. */
class FlakyKms implements Kms {
  readonly keyId = "test-kms";
  down = false;
  private readonly inner = new LocalKms(Buffer.alloc(32, 7).toString("base64"));
  wrap(dek: Buffer) {
    return this.down ? Promise.reject(new Error("kms down")) : this.inner.wrap(dek);
  }
  unwrap(w: Buffer) {
    return this.down ? Promise.reject(new Error("kms down")) : this.inner.unwrap(w);
  }
}

let h: Awaited<ReturnType<typeof startHttp>>;
let kms: FlakyKms;

beforeAll(() => {
  msw.listen({ onUnhandledFrame: "bypass" });
  msw.events.on("request:start", async ({ request }) => {
    if (!request.url.startsWith(DEFAULT_API_BASE_URL)) return;
    outbound.push([...request.headers.entries()].map(([k, v]) => `${k}: ${v}`).join("\n"), await request.clone().text());
  });
});
beforeEach(async () => {
  kms = new FlakyKms();
  h = await startHttp({}, { kms });
});
afterEach(async () => {
  await h.stop();
  mock.reset();
  outbound.length = 0;
});
afterAll(() => msw.close());

const mcpPost = (token: string, body: unknown = INIT_BODY) =>
  fetch(`${h.url}/mcp`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" }, body: JSON.stringify(body) });

async function mcpClient(token: string) {
  const client = new Client({ name: "oauth-test", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${h.url}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
  return client;
}

describe("metadata", () => {
  it("publishes protected-resource metadata (RFC 9728)", async () => {
    for (const p of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"]) {
      const res = await fetch(`${h.url}${p}`);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ resource: RESOURCE, authorization_servers: [PUBLIC_URL], scopes_supported: ["bold"] });
    }
  });

  it("publishes authorization-server metadata (RFC 8414) with S256, DCR and CIMD", async () => {
    const m = (await (await fetch(`${h.url}/.well-known/oauth-authorization-server`)).json()) as Record<string, unknown>;
    expect(m).toMatchObject({
      issuer: PUBLIC_URL,
      authorization_endpoint: `${PUBLIC_URL}/authorize`,
      token_endpoint: `${PUBLIC_URL}/token`,
      registration_endpoint: `${PUBLIC_URL}/register`,
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
    });
  });
});

describe("dynamic client registration", () => {
  it("registers https and loopback redirect URIs", async () => {
    expect(await register(h.url, [REDIRECT, "http://127.0.0.1:33418/callback"])).toMatch(/^bold_client_/);
  });

  it("refuses plain-http, fragment and malformed redirect URIs", async () => {
    for (const uri of ["http://client.example/cb", "https://client.example/cb#x", "not a url"]) {
      const res = await fetch(`${h.url}/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ redirect_uris: [uri] }) });
      expect(res.status, uri).toBe(400);
    }
  });

  it("refuses confidential clients", async () => {
    const res = await fetch(`${h.url}/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ redirect_uris: [REDIRECT], token_endpoint_auth_method: "client_secret_basic" }) });
    expect(res.status).toBe(400);
  });
});

describe("authorization request", () => {
  it("shows the connect page with the client name, return host and a strict CSP", async () => {
    const clientId = await register(h.url);
    const page = await openConnectPage(h.url, authorizeParams(clientId, pkce().challenge));
    expect(page.res.status).toBe(200);
    expect(page.html).toContain("Connect Test Client to Bill of Lading Data");
    expect(page.html).toContain("<strong>client.example</strong>");
    expect(page.html).toContain('type="password"');
    expect(page.html).not.toMatch(/<script/i);
    expect(page.res.headers.get("content-security-policy")).toMatch(/default-src 'none'.*frame-ancestors 'none'/);
    expect(page.res.headers.get("x-frame-options")).toBe("DENY");
    expect(page.csrf).toBeTruthy();
    expect(page.cookie).toBeTruthy();
  });

  it("shows an error page, never a redirect, for an unknown client or unregistered redirect_uri", async () => {
    const clientId = await register(h.url);
    const unknown = await openConnectPage(h.url, authorizeParams("bold_client_nope", pkce().challenge));
    expect(unknown.res.status).toBe(400);
    const wrongRedirect = await openConnectPage(h.url, authorizeParams(clientId, pkce().challenge, { redirect_uri: "https://evil.example/cb" }));
    expect(wrongRedirect.res.status).toBe(400);
    expect(wrongRedirect.res.headers.get("location")).toBeNull();
  });

  it("redirects errors back to a trusted redirect_uri with state and iss", async () => {
    const clientId = await register(h.url);
    const cases: [Record<string, string>, string][] = [
      [{ code_challenge_method: "plain" }, "invalid_request"],
      [{ code_challenge: "short" }, "invalid_request"],
      [{ resource: "https://other.example/mcp" }, "invalid_target"],
      [{ scope: "admin" }, "invalid_scope"],
      [{ response_type: "token" }, "unsupported_response_type"],
    ];
    for (const [extra, error] of cases) {
      const page = await openConnectPage(h.url, authorizeParams(clientId, pkce().challenge, extra));
      expect(page.res.status, JSON.stringify(extra)).toBe(302);
      const loc = new URL(page.res.headers.get("location") as string);
      expect(loc.origin + loc.pathname).toBe(REDIRECT);
      expect(loc.searchParams.get("error")).toBe(error);
      expect(loc.searchParams.get("state")).toBe("st-123");
      expect(loc.searchParams.get("iss")).toBe(PUBLIC_URL);
    }
  });
});

describe("connect page submission", () => {
  async function prepared() {
    const clientId = await register(h.url);
    const p = pkce();
    const params = authorizeParams(clientId, p.challenge);
    return { clientId, p, params, page: await openConnectPage(h.url, params) };
  }

  it("issues a code with state and iss after a valid key, and shows balances", async () => {
    const { params, page } = await prepared();
    const r = await submitKey(h.url, params, page, FAKE_KEY);
    expect(r.res.status).toBe(200);
    expect(r.html).toContain("Connected.");
    expect(r.html).toContain("Data credits");
    expect(r.html).not.toContain("no API plan or credits");
    expect(r.continueUrl?.searchParams.get("code")).toBeTruthy();
    expect(r.continueUrl?.searchParams.get("state")).toBe("st-123");
    expect(r.continueUrl?.searchParams.get("iss")).toBe(PUBLIC_URL);
    expect(r.html).not.toContain(FAKE_KEY);
  });

  it("says 'Key not recognised' for a wrong key and never echoes it", async () => {
    const { params, page } = await prepared();
    const r = await submitKey(h.url, params, page, BAD_KEY);
    expect(r.res.status).toBe(400);
    expect(r.html).toContain("Key not recognised. Paste it again.");
    expect(r.html).not.toContain(BAD_KEY);
    expect(r.continueUrl).toBeUndefined();
  });

  it("warns when the account has no plan or credits", async () => {
    const ok = loadFixtures().get("credit-usage")?.responses.ok?.body;
    const zeroed = JSON.parse(JSON.stringify(ok), (_k, v: unknown) => (typeof v === "number" && _k !== "code" ? 0 : v)) as unknown;
    mock.setResponse("credit-usage", 200, zeroed);
    const { params, page } = await prepared();
    const r = await submitKey(h.url, params, page, FAKE_KEY);
    expect(r.html).toContain("This account has no API plan or credits.");
  });

  it("refuses a missing or mismatched CSRF token", async () => {
    const { params, page } = await prepared();
    expect((await submitKey(h.url, params, { csrf: page.csrf }, FAKE_KEY)).res.status).toBe(403);
    expect((await submitKey(h.url, params, { cookie: page.cookie }, FAKE_KEY)).res.status).toBe(403);
    // A token minted for another authorization request does not transfer.
    const other = await openConnectPage(h.url, authorizeParams(params.client_id as string, pkce().challenge));
    expect((await submitKey(h.url, params, { csrf: other.csrf, cookie: other.cookie }, FAKE_KEY)).res.status).toBe(403);
    expect(mock.calls).toHaveLength(0);
  });

  it("rate-limits key attempts to 5 per 15 minutes per IP", async () => {
    const { params, page } = await prepared();
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await submitKey(h.url, params, page, BAD_KEY)).res.status);
    expect(statuses).toEqual([400, 400, 400, 400, 400, 429]);
  });

  it("stores the spending settings on the connection", async () => {
    const { tokens } = await signIn(h.url, FAKE_KEY, { per_call_limit: "40", daily_limit: "900", allow_contacts: "on" });
    const t = await h.services.tokens.checkAccess(tokens.access_token, RESOURCE);
    const conn = await h.services.db.connections.get(t?.connectionId as string);
    expect(conn?.settings).toEqual({ perCallLimit: 40, dailyLimit: 900, allowContactUnlocks: true, allowKybUnlocks: false });
    // Stored encrypted, never in plaintext.
    expect(JSON.stringify(conn)).not.toContain(FAKE_KEY);
  });
});

describe("token endpoint", () => {
  it("exchanges a code once, with PKCE, quickly", async () => {
    const clientId = await register(h.url);
    const p = pkce();
    const params = authorizeParams(clientId, p.challenge);
    const r = await submitKey(h.url, params, await openConnectPage(h.url, params), FAKE_KEY);
    const code = r.continueUrl?.searchParams.get("code") as string;
    const body = { grant_type: "authorization_code", code, code_verifier: p.verifier, client_id: clientId, redirect_uri: REDIRECT, resource: RESOURCE };

    const wrongVerifier = await fetch(`${h.url}/token`, form({ ...body, code_verifier: pkce().verifier }));
    expect(wrongVerifier.status).toBe(400);
    expect(((await wrongVerifier.json()) as { error: string }).error).toBe("invalid_grant");

    // The failed attempt consumed the code: codes are single-use whatever happens.
    const retry = await fetch(`${h.url}/token`, form(body));
    expect(((await retry.json()) as { error: string }).error).toBe("invalid_grant");
  });

  it("issues opaque boldmcp_ tokens and refuses code replay", async () => {
    const started = Date.now();
    const { tokens, clientId, code, verifier } = await signIn(h.url, FAKE_KEY);
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(tokens.access_token).toMatch(/^boldmcp_[A-Za-z0-9_-]{43}$/);
    expect(tokens.refresh_token).toMatch(/^boldmcp_/);
    expect(tokens.expires_in).toBe(3600);
    const replay = await fetch(`${h.url}/token`, form({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: clientId, redirect_uri: REDIRECT }));
    expect(replay.status).toBe(400);
  });

  it("refuses a code presented by another client or with another redirect_uri", async () => {
    for (const tamper of ["client", "redirect"] as const) {
      const clientId = await register(h.url);
      const p = pkce();
      const params = authorizeParams(clientId, p.challenge);
      const r = await submitKey(h.url, params, await openConnectPage(h.url, params), FAKE_KEY);
      const code = r.continueUrl?.searchParams.get("code") as string;
      const res = await fetch(
        `${h.url}/token`,
        form({ grant_type: "authorization_code", code, code_verifier: p.verifier, client_id: tamper === "client" ? "bold_client_other" : clientId, redirect_uri: tamper === "redirect" ? "https://client.example/other" : REDIRECT }),
      );
      expect(((await res.json()) as { error: string }).error, tamper).toBe("invalid_grant");
    }
  });

  it("refuses an access token minted for another resource", async () => {
    const res = await fetch(`${h.url}/token`, form({ grant_type: "authorization_code", code: "x", code_verifier: pkce().verifier, client_id: "c", resource: "https://other.example/mcp" }));
    expect(((await res.json()) as { error: string }).error).toBe("invalid_target");
  });

  it("rotates refresh tokens and revokes the connection on reuse", async () => {
    const { tokens, clientId } = await signIn(h.url, FAKE_KEY);
    const refresh1 = await fetch(`${h.url}/token`, form({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: clientId }));
    expect(refresh1.status).toBe(200);
    const next = (await refresh1.json()) as { access_token: string; refresh_token: string };
    expect(next.refresh_token).not.toBe(tokens.refresh_token);
    expect((await mcpPost(next.access_token)).status).toBe(200);

    const reuse = await fetch(`${h.url}/token`, form({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: clientId }));
    expect(((await reuse.json()) as { error: string }).error).toBe("invalid_grant");
    // The whole connection is gone, including the newest tokens.
    expect((await mcpPost(next.access_token)).status).toBe(401);
    const afterRevoke = await fetch(`${h.url}/token`, form({ grant_type: "refresh_token", refresh_token: next.refresh_token, client_id: clientId }));
    expect(afterRevoke.status).toBe(400);
  });

  it("refuses a refresh token presented by another client", async () => {
    const { tokens } = await signIn(h.url, FAKE_KEY);
    const res = await fetch(`${h.url}/token`, form({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: "bold_client_other" }));
    expect(((await res.json()) as { error: string }).error).toBe("invalid_grant");
  });

  it("revokes the connection at /revoke", async () => {
    const { tokens } = await signIn(h.url, FAKE_KEY);
    const res = await fetch(`${h.url}/revoke`, form({ token: tokens.refresh_token }));
    expect(res.status).toBe(200);
    expect((await mcpPost(tokens.access_token)).status).toBe(401);
  });
});

describe("using a connection", () => {
  it("calls tools with the stored key; the access token never reaches the Partner API", async () => {
    const { tokens } = await signIn(h.url, FAKE_KEY);
    outbound.length = 0;
    const client = await mcpClient(tokens.access_token);
    const r = (await client.callTool({ name: "get_credit_balance", arguments: {} })) as { isError?: boolean };
    expect(r.isError).toBeFalsy();
    await client.close();
    expect(outbound.length).toBeGreaterThan(0);
    const sent = outbound.join("\n");
    expect(sent).toContain(`api-key: ${FAKE_KEY}`);
    expect(sent).not.toContain("boldmcp_");
    expect(sent).not.toMatch(/authorization:/i);
  });

  it("answers 401 with the challenge for an unknown token", async () => {
    const res = await mcpPost("boldmcp_unknowntoken");
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain('resource_metadata="https://mcp.test.example/.well-known/oauth-protected-resource"');
  });

  it("marks the connection invalid when the API rejects the stored key", async () => {
    const { tokens } = await signIn(h.url, FAKE_KEY);
    const client = await mcpClient(tokens.access_token);
    mock.setScenario("credit-usage", "401");
    const r = (await client.callTool({ name: "get_credit_balance", arguments: {} })) as { isError?: boolean };
    expect(r.isError).toBe(true);
    await client.close();
    expect((await mcpPost(tokens.access_token)).status).toBe(401);
  });

  it("answers 503 when the key vault is unavailable", async () => {
    const { tokens } = await signIn(h.url, FAKE_KEY);
    kms.down = true;
    const res = await mcpPost(tokens.access_token);
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain(FAKE_KEY);
  });

  it("logs neither the key nor any token", async () => {
    const { tokens } = await signIn(h.url, FAKE_KEY);
    const client = await mcpClient(tokens.access_token);
    await client.callTool({ name: "get_credit_balance", arguments: {} });
    await client.close();
    const logs = h.logs.join("");
    expect(logs).not.toContain(FAKE_KEY);
    expect(logs).not.toContain(tokens.access_token);
    expect(logs).not.toContain(tokens.refresh_token);
    expect(logs).toContain("connection created");
  });
});

describe("CIMD clients", () => {
  it("accepts a URL client_id whose metadata lists the redirect_uri, with no registration", async () => {
    const ID = "https://app.example/oauth/client.json";
    const cimd = new CimdFetcher({
      resolve: async () => ["93.184.216.34"],
      fetchImpl: (async () => new Response(JSON.stringify({ client_id: ID, client_name: "Example App", redirect_uris: [REDIRECT] }))) as never,
    });
    const own = await startHttp({}, { cimd });
    try {
      const p = pkce();
      const params = authorizeParams(ID, p.challenge);
      const page = await openConnectPage(own.url, params);
      expect(page.html).toContain("Connect Example App to Bill of Lading Data");
      const r = await submitKey(own.url, params, page, FAKE_KEY);
      const code = r.continueUrl?.searchParams.get("code") as string;
      const tok = await fetch(`${own.url}/token`, form({ grant_type: "authorization_code", code, code_verifier: p.verifier, client_id: ID, redirect_uri: REDIRECT }));
      expect(tok.status).toBe(200);
    } finally {
      await own.stop();
    }
  });
});
