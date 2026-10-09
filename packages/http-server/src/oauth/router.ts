import { createHash, randomBytes, randomUUID } from "node:crypto";
import express, { type Request, type Response, type Router } from "express";
import { ApiKeySchema, DEFAULT_SETTINGS, HOUR, keyFingerprint, MINUTE, parseCreditUsage, PartnerApiError, type SpendingSettings } from "@bold-mcp/core";
import type { OAuthClient } from "../db/types.js";
import type { Services } from "../services.js";
import type { EncryptedKey } from "../vault/key-vault.js";
import { CimdError, isCimdClientId } from "./cimd.js";
import { CSRF_COOKIE, CSRF_MAX_AGE_MS } from "./csrf.js";
import { isAcceptableRedirect, redirectMatches } from "./redirects.js";
import { connectedPage, connectPage, errorPage } from "./views/connect.js";

const CODE_TTL_MS = 5 * 60_000;
const SCOPE = "bold";

/** Pending authorization, kept (encrypted key included) until the code is exchanged. */
interface CodeRecord {
  connectionId: string;
  encryptedKey: EncryptedKey;
  fingerprint: string;
  clientId: string;
  clientName: string;
  redirectUri: string;
  codeChallenge: string;
  resource: string;
  settings: SpendingSettings;
}

interface AuthRequest {
  client: OAuthClient;
  clientId: string;
  redirectUri: string;
  state: string | undefined;
  codeChallenge: string;
  resource: string;
}

class AuthorizeError extends Error {
  constructor(
    /** "page": show an error page (client or redirect untrusted). "redirect": send the error to the client. */
    readonly mode: "page" | "redirect",
    readonly code: string,
    message: string,
    readonly redirectUri?: string,
    readonly state?: string,
  ) {
    super(message);
  }
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
const s256 = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");
const VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/;
const CHALLENGE = /^[A-Za-z0-9\-_]{43}$/;

function clientIp(req: Request): string {
  return req.ip ?? req.socket.remoteAddress ?? "unknown";
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

function intField(v: unknown, fallback: number, max: number): number {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? Math.min(n, max) : fallback;
}

export function oauthRouter(s: Services): Router {
  const { config, db, deps } = s;
  const issuer = config.BOLD_PUBLIC_URL;
  const resource = `${issuer}/mcp`;
  const links = { logoUrl: config.BOLD_LOGO_URL, findKeyUrl: config.BOLD_FIND_KEY_URL, trialUrl: config.BOLD_TRIAL_URL };
  const secureCookie = issuer.startsWith("https://");
  const router = express.Router();

  // Metadata and token endpoints may be called from browser-based clients.
  const cors = (_req: Request, res: Response, next: () => void) => {
    res.set({ "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, authorization, mcp-protocol-version", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" });
    next();
  };
  for (const p of ["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-authorization-server", "/token", "/register", "/revoke"]) {
    router.options(p, cors, (_req, res) => void res.sendStatus(204));
  }

  // ---- Metadata (RFC 9728, RFC 8414) ----------------------------------------

  const protectedResource = { resource, authorization_servers: [issuer], scopes_supported: [SCOPE], bearer_methods_supported: ["header"], resource_name: "Bill of Lading Data" };
  router.get(["/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp"], cors, (_req, res) => {
    res.set("Cache-Control", "public, max-age=3600").json(protectedResource);
  });

  router.get("/.well-known/oauth-authorization-server", cors, (_req, res) => {
    res.set("Cache-Control", "public, max-age=3600").json({
      issuer,
      authorization_endpoint: `${issuer}/authorize`,
      token_endpoint: `${issuer}/token`,
      registration_endpoint: `${issuer}/register`,
      revocation_endpoint: `${issuer}/revoke`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      revocation_endpoint_auth_methods_supported: ["none"],
      scopes_supported: [SCOPE],
      client_id_metadata_document_supported: true,
      authorization_response_iss_parameter_supported: true,
    });
  });

  // ---- Dynamic client registration (RFC 7591) -----------------------------------

  router.post("/register", cors, express.json({ limit: "16kb" }), async (req, res) => {
    const limit = await deps.rateLimits.consume(`ip:register:${clientIp(req)}`, [{ name: "hour", windowMs: HOUR, limit: 30 }]);
    if (!limit.allowed) return void res.status(429).json({ error: "too_many_requests" });
    const b = (req.body ?? {}) as Record<string, unknown>;
    const uris = Array.isArray(b.redirect_uris) ? b.redirect_uris.filter((u): u is string => typeof u === "string") : [];
    if (uris.length === 0 || uris.length > 20 || !uris.every(isAcceptableRedirect))
      return void res.status(400).json({ error: "invalid_redirect_uri", error_description: "redirect_uris must be https URLs or http loopback URLs" });
    const method = str(b.token_endpoint_auth_method) ?? "none";
    if (method !== "none") return void res.status(400).json({ error: "invalid_client_metadata", error_description: "only token_endpoint_auth_method none is supported" });
    const name = (str(b.client_name) ?? "AI client").slice(0, 100);
    const id = `bold_client_${randomBytes(16).toString("base64url")}`;
    await db.clients.upsert({ id, kind: "dcr", clientName: name, redirectUris: uris, metadata: {} });
    res.status(201).set("Cache-Control", "no-store").json({
      client_id: id,
      client_id_issued_at: Math.floor(Date.now() / 1000),
      client_name: name,
      redirect_uris: uris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
    });
  });

  // ---- Authorization request -----------------------------------------------------

  async function resolveClient(clientId: string): Promise<OAuthClient> {
    if (isCimdClientId(clientId)) {
      try {
        const c = await s.cimd.fetch(clientId);
        await db.clients.upsert(c);
        return c;
      } catch (err) {
        throw new AuthorizeError("page", "invalid_client", err instanceof CimdError ? `This app's details could not be verified: ${err.message}.` : "This app's details could not be verified.");
      }
    }
    const c = await db.clients.get(clientId);
    if (!c) throw new AuthorizeError("page", "invalid_client", "This app is not registered with Bill of Lading Data. Try connecting again from your AI tool.");
    return c;
  }

  async function parseAuthRequest(q: Record<string, unknown>): Promise<AuthRequest> {
    const clientId = str(q.client_id);
    const redirectUri = str(q.redirect_uri);
    if (!clientId) throw new AuthorizeError("page", "invalid_request", "The request is missing client_id.");
    const client = await resolveClient(clientId);
    if (!redirectUri || !redirectMatches(redirectUri, client.redirectUris))
      throw new AuthorizeError("page", "invalid_request", "The return address (redirect_uri) is not registered for this app.");
    const state = str(q.state);
    const fail = (code: string, msg: string) => new AuthorizeError("redirect", code, msg, redirectUri, state);
    if (q.response_type !== "code") throw fail("unsupported_response_type", "response_type must be code");
    const codeChallenge = str(q.code_challenge);
    if (q.code_challenge_method !== "S256" || !codeChallenge || !CHALLENGE.test(codeChallenge)) throw fail("invalid_request", "PKCE with code_challenge_method S256 is required");
    if (str(q.resource) !== resource) throw fail("invalid_target", `resource must be ${resource}`);
    const scope = str(q.scope);
    if (scope && !scope.split(" ").every((x) => x === SCOPE)) throw fail("invalid_scope", `the only scope is ${SCOPE}`);
    return { client, clientId, redirectUri, state, codeChallenge, resource };
  }

  const hiddenFields = (a: AuthRequest): Record<string, string> => ({
    response_type: "code",
    client_id: a.clientId,
    redirect_uri: a.redirectUri,
    code_challenge: a.codeChallenge,
    code_challenge_method: "S256",
    resource: a.resource,
    scope: SCOPE,
    ...(a.state !== undefined ? { state: a.state } : {}),
  });
  const bindTo = (a: AuthRequest) => JSON.stringify([a.clientId, a.redirectUri, a.codeChallenge, a.resource, a.state ?? ""]);

  function redirectWith(uri: string, params: Record<string, string | undefined>): string {
    const u = new URL(uri);
    for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, v);
    return u.toString();
  }

  function pageHeaders(res: Response): string {
    const nonce = randomBytes(16).toString("base64");
    res.set({
      "Content-Security-Policy": `default-src 'none'; style-src 'nonce-${nonce}'; img-src ${new URL(config.BOLD_LOGO_URL).origin}; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`,
      "X-Frame-Options": "DENY",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    });
    return nonce;
  }

  function handleAuthorizeError(res: Response, err: unknown): void {
    if (err instanceof AuthorizeError) {
      if (err.mode === "redirect" && err.redirectUri) {
        return void res.redirect(302, redirectWith(err.redirectUri, { error: err.code, error_description: err.message, state: err.state, iss: issuer }));
      }
      const nonce = pageHeaders(res);
      return void res.status(400).type("html").send(errorPage("Can't connect", err.message, nonce));
    }
    deps.logger.error({ err_name: err instanceof Error ? err.name : "unknown" }, "authorize failed");
    const nonce = pageHeaders(res);
    res.status(500).type("html").send(errorPage("Something went wrong", "Please try again in a moment.", nonce));
  }

  function renderForm(res: Response, a: AuthRequest, opts: { error?: string; settings?: SpendingSettings; status?: number } = {}) {
    const nonce = pageHeaders(res);
    const cookieNonce = s.csrf.newNonce();
    res.cookie(CSRF_COOKIE, cookieNonce, { httpOnly: true, secure: secureCookie, sameSite: "lax", path: "/authorize", maxAge: CSRF_MAX_AGE_MS });
    res
      .status(opts.status ?? 200)
      .type("html")
      .send(
        connectPage({
          clientName: a.client.clientName ?? "your AI tool",
          redirectHost: new URL(a.redirectUri).host,
          hidden: hiddenFields(a),
          csrf: s.csrf.token(cookieNonce, bindTo(a)),
          settings: opts.settings ?? DEFAULT_SETTINGS,
          links,
          nonce,
          ...(opts.error ? { error: opts.error } : {}),
        }),
      );
  }

  router.get("/authorize", async (req, res) => {
    try {
      renderForm(res, await parseAuthRequest(req.query as Record<string, unknown>));
    } catch (err) {
      handleAuthorizeError(res, err);
    }
  });

  router.post("/authorize", express.urlencoded({ extended: false, limit: "16kb" }), async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    let a: AuthRequest;
    try {
      a = await parseAuthRequest(body);
    } catch (err) {
      return handleAuthorizeError(res, err);
    }
    try {
      if (!s.csrf.verify(str(body.csrf), readCookie(req, CSRF_COOKIE), bindTo(a))) {
        return renderForm(res, a, { error: "This page expired. Paste your key again.", status: 403 });
      }
      const limit = await deps.rateLimits.consume(`ip:connect:${clientIp(req)}`, [{ name: "15 minutes", windowMs: 15 * MINUTE, limit: 5 }]);
      if (!limit.allowed) {
        const wait = Math.ceil(limit.retryAfterMs / 60_000);
        return renderForm(res, a, { error: `Too many attempts. Try again in ${wait} minute${wait === 1 ? "" : "s"}.`, status: 429 });
      }
      const settings: SpendingSettings = {
        perCallLimit: intField(body.per_call_limit, DEFAULT_SETTINGS.perCallLimit, 100_000),
        dailyLimit: intField(body.daily_limit, DEFAULT_SETTINGS.dailyLimit, 1_000_000),
        allowContactUnlocks: body.allow_contacts === "on",
        allowKybUnlocks: body.allow_kyb === "on",
      };
      const parsedKey = ApiKeySchema.safeParse(body.api_key);
      if (!parsedKey.success) return renderForm(res, a, { error: "That doesn't look like an API key. Paste it again.", settings, status: 400 });
      const apiKey = parsedKey.data;

      let balances;
      try {
        balances = parseCreditUsage((await s.validationClient.call("credit-usage", {}, apiKey)).data).balances;
      } catch (err) {
        if (err instanceof PartnerApiError && err.kind === "unauthorized") return renderForm(res, a, { error: "Key not recognised. Paste it again.", settings, status: 400 });
        deps.logger.warn({ err_kind: err instanceof PartnerApiError ? err.kind : "unknown" }, "key check failed");
        return renderForm(res, a, { error: "We couldn't check your key just now. Please try again.", settings, status: 503 });
      }

      const connectionId = randomUUID();
      const record: CodeRecord = {
        connectionId,
        encryptedKey: await s.vault.encrypt(apiKey, connectionId),
        fingerprint: keyFingerprint(apiKey),
        clientId: a.clientId,
        clientName: a.client.clientName ?? "AI client",
        redirectUri: a.redirectUri,
        codeChallenge: a.codeChallenge,
        resource: a.resource,
        settings,
      };
      const code = randomBytes(32).toString("base64url");
      await s.ephemeral.set(`code:${createHash("sha256").update(code).digest("hex")}`, JSON.stringify(record), CODE_TTL_MS);
      deps.logger.info({ key_fp: record.fingerprint, client_id: a.clientId }, "connect: key accepted");

      const zero = [balances.data, balances.contact, balances.kyb].every((p) => (p.total ?? 0) === 0 && (p.remaining ?? 0) === 0);
      const nonce = pageHeaders(res);
      res.clearCookie(CSRF_COOKIE, { path: "/authorize" });
      res.type("html").send(
        connectedPage({
          clientName: record.clientName,
          redirectHost: new URL(a.redirectUri).host,
          continueUrl: redirectWith(a.redirectUri, { code, state: a.state, iss: issuer }),
          balances: { data: balances.data.remaining, contact: balances.contact.remaining, kyb: balances.kyb.remaining },
          zeroBalance: zero,
          links,
          nonce,
        }),
      );
    } catch (err) {
      handleAuthorizeError(res, err);
    }
  });

  // ---- Token endpoint ------------------------------------------------------------

  const tokenError = (res: Response, error: string, description: string, status = 400) =>
    void res.status(status).set("Cache-Control", "no-store").json({ error, error_description: description });

  router.post("/token", cors, express.urlencoded({ extended: false, limit: "16kb" }), express.json({ limit: "16kb" }), async (req, res) => {
    const limit = await deps.rateLimits.consume(`ip:token:${clientIp(req)}`, [{ name: "minute", windowMs: MINUTE, limit: 60 }]);
    if (!limit.allowed) return tokenError(res, "slow_down", "Too many token requests", 429);
    const b = (req.body ?? {}) as Record<string, unknown>;
    const clientId = str(b.client_id);
    if (!clientId) return tokenError(res, "invalid_client", "client_id is required", 401);
    if (b.resource !== undefined && b.resource !== resource) return tokenError(res, "invalid_target", `resource must be ${resource}`);

    try {
      if (b.grant_type === "authorization_code") {
        const code = str(b.code);
        const verifier = str(b.code_verifier);
        if (!code || !verifier || !VERIFIER.test(verifier)) return tokenError(res, "invalid_request", "code and a valid code_verifier are required");
        const raw = await s.ephemeral.take(`code:${createHash("sha256").update(code).digest("hex")}`);
        if (!raw) return tokenError(res, "invalid_grant", "The authorization code is invalid, expired or already used");
        const rec = JSON.parse(raw) as CodeRecord;
        if (rec.clientId !== clientId) return tokenError(res, "invalid_grant", "The code was issued to another client");
        if (str(b.redirect_uri) !== rec.redirectUri) return tokenError(res, "invalid_grant", "redirect_uri does not match the authorization request");
        if (s256(verifier) !== rec.codeChallenge) return tokenError(res, "invalid_grant", "PKCE verification failed");
        await db.connections.create({
          id: rec.connectionId,
          encryptedKey: rec.encryptedKey,
          keyFingerprint: rec.fingerprint,
          clientId: rec.clientId,
          clientName: rec.clientName,
          settings: rec.settings,
        });
        const tokens = await s.tokens.issue(rec.connectionId, rec.clientId, rec.resource);
        deps.logger.info({ connection_id: rec.connectionId, key_fp: rec.fingerprint, client_id: clientId }, "connection created");
        return void res.set("Cache-Control", "no-store").json(tokens);
      }

      if (b.grant_type === "refresh_token") {
        const refresh = str(b.refresh_token);
        if (!refresh) return tokenError(res, "invalid_request", "refresh_token is required");
        const r = await s.tokens.rotate(refresh, clientId);
        if (!r) return tokenError(res, "invalid_grant", "The refresh token is invalid or expired");
        if (r.reused) {
          await db.connections.revoke(r.record.connectionId, "refresh token reuse");
          deps.logger.warn({ connection_id: r.record.connectionId }, "refresh token reuse: connection revoked");
          return tokenError(res, "invalid_grant", "The refresh token was already used; the connection has been revoked. Connect again.");
        }
        const conn = await db.connections.get(r.record.connectionId);
        if (!conn || conn.revokedAt || conn.invalidAt) return tokenError(res, "invalid_grant", "This connection is no longer valid. Connect again.");
        const tokens = await s.tokens.issue(conn.id, clientId, r.record.resource, r.record.familyId);
        return void res.set("Cache-Control", "no-store").json(tokens);
      }

      return tokenError(res, "unsupported_grant_type", "grant_type must be authorization_code or refresh_token");
    } catch (err) {
      deps.logger.error({ err_name: err instanceof Error ? err.name : "unknown" }, "token endpoint failed");
      return tokenError(res, "server_error", "Something went wrong", 500);
    }
  });

  // ---- Revocation (RFC 7009) -------------------------------------------------------

  router.post("/revoke", cors, express.urlencoded({ extended: false, limit: "16kb" }), express.json({ limit: "16kb" }), async (req, res) => {
    const token = str((req.body as Record<string, unknown> | undefined)?.token);
    if (token) {
      const rec = await db.tokens.get(createHash("sha256").update(token, "utf8").digest("hex"));
      if (rec) {
        await db.connections.revoke(rec.connectionId, "revoked by client");
        deps.logger.info({ connection_id: rec.connectionId }, "connection revoked");
      }
    }
    res.set("Cache-Control", "no-store").status(200).end();
  });

  return router;
}
