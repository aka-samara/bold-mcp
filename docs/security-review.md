# Security review (M4)

Review of the server against the brief's "Errors, rate limits, security and privacy" section, done on branch `m4-unlocks-hardening`. Each control names the code and the test that proves it. "Needs the team" items cannot be finished in code.

## Findings fixed in this review

| # | Finding | Risk | Fix | Test |
| --- | --- | --- | --- | --- |
| S1 | `trust proxy` was `true`, so any client could set `X-Forwarded-For` and get a fresh IP for every request. | Bypass of the per-IP limits on the connect page, `/token` and `/register` (key guessing). | `BOLD_TRUST_PROXY_HOPS` (default 0; set to the number of load balancers in front, normally 1). | `test/http/hardening.test.ts` "ignores X-Forwarded-For unless proxy hops are configured" |
| S2 | Header mode checked every new key with a Credit Usage call, unlimited. | `/mcp` usable as a bulk key-testing oracle, and load on the Partner API. | Keys not in the validity cache are limited to 20 a minute per IP (429 after that). | "limits new-key checks to 20 a minute per IP" |
| S3 | `GET /authorize` had no limit, and each request with a URL `client_id` fetches that URL. | Using the server to send many requests to third-party sites. | 60 a minute per IP, on top of the CIMD fetch rules (S10). | "rate-limits GET /authorize" |
| S4 | Express's default error handler prints stack traces outside production. | Internal details in responses if `NODE_ENV` is misconfigured. | Final error handler: generic JSON body, error name only in the log. | "answers malformed JSON without a stack trace" |
| S5 | No security headers on JSON responses. | Low (no HTML outside the connect page). | `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, HSTS when the public URL is https. Connect page also has a nonce CSP with `default-src 'none'`, `form-action 'self'`, `frame-ancestors 'none'`. | "sets security headers" and `test/oauth/oauth-flow.test.ts` |

## Controls checked

**API keys**

- Plaintext key only inside the request that uses it; sent to the Partner API in the `api-key` header only (`packages/core/src/client/partner-client.ts`). The OAuth access token is never forwarded: `test/oauth/oauth-flow.test.ts` captures every outbound request and checks for `boldmcp_` and `authorization:`.
- Keys in URLs are refused with 400 (`auth/credentials.ts`, `test/http/header-mode.test.ts`).
- Stored keys: AES-256-GCM with a per-key data key wrapped by the KMS, connection id as associated data (`vault/key-vault.ts`, `test/unit/vault-cimd.test.ts`). The code record that holds the key before the token exchange holds only the encrypted form.
- Logs: ESLint rule bans key/token names inside logging calls; pino redaction as a safety net; `test/http/key-safety.test.ts` runs every tool (including unlocks and confirmations) and every error path, then searches logs, results, error bodies and upstream bodies for the keys. `test/oauth/oauth-flow.test.ts` does the same for access and refresh tokens.
- CI fails if the test key's first 8 characters appear in any file or commit (`scripts/check-key-leak.mjs --history`).

**Tokens and sessions**

- Opaque `boldmcp_` + 256-bit random tokens; only SHA-256 hashes stored. Audience (`resource`) and expiry checked on every request; refresh tokens rotate and reuse revokes the connection (concurrent double use counts as reuse: `test/integration/stores.test.ts`).
- PKCE S256 only, exact redirect URI match (any port for loopback), single-use 5-minute codes consumed even by a failed exchange, `iss` in every authorization response, `invalid_target` for another resource.
- MCP sessions are random UUIDs bound to the connection (or key fingerprint) that created them; another credential gets 404.
- `Origin` checked on `/mcp`: claude.ai, claude.com, chatgpt.com, chat.openai.com, the server's own origin, localhost, plus `BOLD_ALLOWED_ORIGINS`.

**Connect page**

- No scripts. CSRF: HttpOnly SameSite=Lax cookie nonce + HMAC form token bound to the authorization request, 30 minutes. 5 key attempts per 15 minutes per IP. The page shows the host the user will be sent back to, so a lookalike client name cannot hide where the code goes. Key field is a password input and is never echoed back.

**CIMD**

- HTTPS only, DNS resolved once and pinned (no rebinding), private, loopback, link-local, CGNAT, ULA and IPv4-mapped addresses refused, no redirects, 5 s timeout, 64 KB cap, `client_id` must equal the URL, public clients only.

**Credits and unlocks**

- A paid call above the per-call limit, above the daily limit, or above the pool balance never reaches the API without confirmation (or is refused). Unlocks always ask and respect the allow switches; tokens are single-use, bound to the connection, tool and exact arguments, 10 minutes (`test/contract/paid-tools.test.ts`, `test/contract/unlock-tools.test.ts`).
- API text is data only: summaries never quote API data, and descriptions are static.

**Privacy**

- Unlock results drop `profile_pic` and officer date-of-birth fields. Each unlock is audit-logged with ids and types only (`unlock_audit`); revealed details never reach logs.
- The usage log holds tool, pool, credits, outcome and latency, never arguments or results.

**Supply chain**

- `npm audit --audit-level=high` in CI (0 findings today); container image scanned with Trivy in CI; non-root image user.

## Needs the team

| Item | Why it can't be finished in code |
| --- | --- |
| Cloud KMS key and adapter | Needs the hosting account; `LocalKms` refuses to start in production by config check. |
| WAF / firewall allow-list for Claude (`160.79.104.0/21`) and ChatGPT egress ranges | Hosting account. |
| Privacy notice and terms covering stored keys and sending results to AI providers | Legal text for publication (stop-and-ask item). |
| External penetration test before the directory submissions | Optional but recommended for directory review. |
| Secrets (`BOLD_CONFIRMATION_SECRET`, `BOLD_CSRF_SECRET`) in a secrets manager, rotated yearly | Hosting account. |
