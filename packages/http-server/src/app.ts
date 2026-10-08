import { randomUUID } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { createBoldServer, keyFingerprint, MINUTE, type CallerContext, type Extra } from "@bold-mcp/core";
import type { HttpConfig } from "./config.js";
import { sendUnauthorized } from "./auth/challenge.js";
import { hasKeyInUrl, readCredential, settingsFromHeaders } from "./auth/credentials.js";
import { KeyValidator } from "./auth/key-validator.js";
import { SessionStore } from "./mcp/sessions.js";
import { oauthRouter } from "./oauth/router.js";
import type { Services } from "./services.js";
import { KmsError } from "./vault/key-vault.js";

type AuthedRequest = Request & { auth?: AuthInfo; caller?: CallerContext };

const SESSION_HEADER = "mcp-session-id";

function jsonRpcError(res: Response, status: number, code: number, message: string): void {
  res.status(status).json({ jsonrpc: "2.0", error: { code, message }, id: null });
}

export function createApp(s: Services) {
  const { config, deps, db } = s;
  const logger = deps.logger;
  const validator = new KeyValidator(deps.client, s.keyCache, config.BOLD_KEY_CACHE_TTL_MS);
  const resource = `${config.BOLD_PUBLIC_URL}/mcp`;
  const idleMs = config.BOLD_CONNECTION_IDLE_DAYS * 24 * 60 * 60_000;
  const sessions = new SessionStore(config.BOLD_SESSION_IDLE_MS, config.BOLD_MAX_SESSIONS);
  sessions.start();

  const app = express();
  app.disable("x-powered-by");
  // Only trust X-Forwarded-For through known proxy hops, so clients cannot pick their own IP for rate limits.
  app.set("trust proxy", config.BOLD_TRUST_PROXY_HOPS);

  app.use((_req, res, next) => {
    res.set({ "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Frame-Options": "DENY" });
    if (config.BOLD_PUBLIC_URL.startsWith("https://")) res.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    next();
  });

  // Never log query strings or headers: only method, path and status.
  app.use((req, res, next) => {
    const started = Date.now();
    res.on("finish", () => logger.info({ method: req.method, path: req.path, status: res.statusCode, ms: Date.now() - started }, "http"));
    next();
  });

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true, sessions: sessions.size });
  });

  app.use(oauthRouter(s));

  /** OAuth mode: access token → connection → stored key, decrypted for this request only. */
  async function oauthCaller(token: string): Promise<CallerContext | "invalid"> {
    const t = await s.tokens.checkAccess(token, resource);
    if (!t) return "invalid";
    const conn = await db.connections.get(t.connectionId);
    if (!conn || conn.revokedAt || conn.invalidAt) return "invalid";
    if (Date.now() - conn.lastUsedAt.getTime() > idleMs) return "invalid";
    const apiKey = await s.vault.decrypt(conn.encryptedKey, conn.id);
    void db.connections.touch(conn.id).catch(() => logger.warn({ connection_id: conn.id }, "connection touch failed"));
    return {
      apiKey,
      fingerprint: conn.keyFingerprint,
      connectionId: conn.id,
      authMode: "oauth",
      keyStatus: "valid",
      settings: conn.settings,
      onKeyRejected: async () => {
        logger.warn({ connection_id: conn.id, key_fp: conn.keyFingerprint }, "stored key rejected by the API; connection marked invalid");
        await db.connections.markInvalid(conn.id);
      },
    };
  }

  /** Refuse keys in URLs, check Origin, read the credential. */
  async function authenticate(req: AuthedRequest, res: Response, next: NextFunction) {
    if (hasKeyInUrl(req.originalUrl)) {
      res.status(400).json({ error: "invalid_request", error_description: "Never put an API key in the URL. Send it in the Authorization header." });
      return;
    }
    const origin = req.headers.origin;
    if (origin && !isAllowedOrigin(origin, config)) {
      res.status(403).json({ error: "forbidden", error_description: "Origin not allowed" });
      return;
    }
    const cred = readCredential(req.headers);
    if (cred.kind === "none") return sendUnauthorized(res, config.BOLD_PUBLIC_URL, "No API key or access token", "");
    if (cred.kind === "malformed") return sendUnauthorized(res, config.BOLD_PUBLIC_URL, cred.reason, "invalid_request");
    if (cred.kind === "oauth_token") {
      let caller: CallerContext | "invalid";
      try {
        caller = await oauthCaller(cred.token);
      } catch (err) {
        if (err instanceof KmsError) {
          logger.error({ err_name: err.name }, "key vault unavailable");
          res.status(503).set("Retry-After", "30").json({ error: "temporarily_unavailable", error_description: "Stored keys cannot be read right now. Try again shortly." });
          return;
        }
        throw err;
      }
      if (caller === "invalid") return sendUnauthorized(res, config.BOLD_PUBLIC_URL, "Access token expired, revoked or unknown. Sign in again.");
      req.caller = caller;
      req.auth = { token: caller.fingerprint, clientId: "oauth", scopes: ["bold"], extra: { caller } };
      next();
      return;
    }
    // A key not seen recently costs one Credit Usage call to check: limit those per IP so /mcp can't be used to test keys in bulk.
    if (!(await s.keyCache.get(keyFingerprint(cred.apiKey)))) {
      const limit = await deps.rateLimits.consume(`ip:keycheck:${req.ip ?? "unknown"}`, [{ name: "minute", windowMs: MINUTE, limit: 20 }]);
      if (!limit.allowed) {
        res.status(429).set("Retry-After", String(Math.ceil(limit.retryAfterMs / 1000))).json({ error: "too_many_requests", error_description: "Too many different API keys from this address. Try again shortly." });
        return;
      }
    }
    const { fingerprint, status } = await validator.check(cred.apiKey);
    req.caller = {
      apiKey: cred.apiKey,
      fingerprint,
      connectionId: null,
      authMode: "header",
      keyStatus: status,
      settings: settingsFromHeaders(req.headers),
    };
    // AuthInfo reaches tool handlers as extra.authInfo; `token` holds the fingerprint, never the key.
    req.auth = { token: fingerprint, clientId: "header", scopes: ["bold"], extra: { caller: req.caller } };
    next();
  }

  const getCaller = (extra: Extra): CallerContext => {
    const caller = extra.authInfo?.extra?.caller as CallerContext | undefined;
    if (!caller) throw new Error("No caller on request");
    return caller;
  };

  app.post("/mcp", express.json({ limit: "1mb" }), authenticate, async (req: AuthedRequest, res) => {
    const caller = req.caller as CallerContext;
    const binding = caller.connectionId ?? caller.fingerprint;
    const sessionId = req.header(SESSION_HEADER);
    try {
      if (sessionId) {
        const session = sessions.get(sessionId);
        if (!session || session.binding !== binding) return jsonRpcError(res, 404, -32001, "Session not found");
        sessions.touch(session);
        await session.transport.handleRequest(req, res, req.body);
        return;
      }
      if (!isInitializeRequest(req.body)) return jsonRpcError(res, 400, -32000, "Bad Request: no session id; send initialize first");

      const server = createBoldServer({ deps, getCaller });
      const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          if (!sessions.add({ id, binding, server, transport, lastSeen: Date.now() })) {
            logger.warn({ sessions: sessions.size }, "session limit reached");
          }
        },
      });
      transport.onclose = () => {
        if (transport.sessionId) void sessions.remove(transport.sessionId);
      };
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (err) {
      logger.error({ err_name: err instanceof Error ? err.name : "unknown", key_fp: caller.fingerprint }, "mcp request failed");
      if (!res.headersSent) jsonRpcError(res, 500, -32603, "Internal server error");
    }
  });

  const sessionRequest = async (req: AuthedRequest, res: Response) => {
    const caller = req.caller as CallerContext;
    const sessionId = req.header(SESSION_HEADER);
    const session = sessionId ? sessions.get(sessionId) : undefined;
    if (!session || session.binding !== (caller.connectionId ?? caller.fingerprint)) return jsonRpcError(res, 404, -32001, "Session not found");
    sessions.touch(session);
    await session.transport.handleRequest(req, res);
  };
  app.get("/mcp", authenticate, sessionRequest);
  app.delete("/mcp", authenticate, sessionRequest);

  app.use((_req, res) => {
    res.status(404).json({ error: "not_found" });
  });

  // Last resort: never send stack traces or error text to clients; log the error name only.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Express needs four parameters to treat this as an error handler
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    const status = typeof (err as { status?: unknown })?.status === "number" ? (err as { status: number }).status : 500;
    if (status >= 500) logger.error({ err_name: err instanceof Error ? err.name : "unknown", path: req.path }, "request failed");
    if (res.headersSent) return;
    res.status(status).json({ error: status >= 500 ? "server_error" : "invalid_request" });
  });

  return { app, sessions };
}

export function isAllowedOrigin(origin: string, config: HttpConfig): boolean {
  if (config.BOLD_ALLOWED_ORIGINS.includes(origin)) return true;
  if (origin === config.BOLD_PUBLIC_URL) return true;
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(origin);
}
