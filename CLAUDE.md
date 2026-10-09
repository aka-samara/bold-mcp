# bold-mcp — conventions

MCP server for the Bill of Lading Data **global** Partner API (16 tabs, 22 endpoint paths, 18 tools), reached with the customer's own API key. The spec is `docs/BRIEF.md`; choices it leaves open are in `docs/decisions.md`; differences between the brief and the live API are in `docs/api-notes.md`. Country-specific endpoints (`/partner-api/US/...`, `/partner-api/IN/...`) are out of scope.

## Layout

```
packages/core/         shared core: every tool lives here, so all transports get identical tools
  src/client/          Partner API client: 22 global paths, api-key header, timeouts, retries, error mapping
  src/schemas/         Zod input/output schemas, one file per tool
  src/tools/           one file per tool: definition, description, handler
  src/billing/         costs.ts (cost table, loaded from config), pools, estimator, balance cache, confirmation tokens, limits
  src/shaping/         response normalisers (incl. Financial KYB reshaping)
  src/resources/ src/prompts/
  src/server.ts        builds the McpServer and registers everything
packages/http-server/  Streamable HTTP (/mcp), header-mode keys, OAuth paste-your-key sign-in, key vault, db
packages/stdio/        npm @billofladingdata/mcp, reads BOLD_API_KEY
test/                  unit/ contract/ protocol/ http/ oauth/ integration/ browser/ fixtures/ msw/
docs/                  BRIEF.md api-notes.md decisions.md tools.md clients/
infra/                 Dockerfile, deploy config, dashboards, alerts
scripts/               gate, fixture recording, key-leak check
```

## Stack

Node.js current LTS (24; CI reads `.nvmrc`, `engines` allows 22+), TypeScript strict, ES modules. Official `@modelcontextprotocol/sdk`, Zod 4 (`z.toJSONSchema`), Hono or Express with the SDK's Node integration, `jose` for signed confirmation tokens, PostgreSQL, Redis, cloud KMS, pino, OpenTelemetry. Tests: Vitest, msw, Playwright (connect page), MCP Inspector CLI.

## Coding rules

- One tool per file; description, schemas and handler together. Names are `snake_case`.
- No `any`. Every API response is parsed with Zod; unknown fields are dropped.
- All credit maths and pool mapping live in `packages/core/src/billing/`, covered by unit tests. Prices come from the cost table, never inline numbers in tools.
- Every tool returns `structuredContent` matching its `outputSchema`, plus a short text summary. Free text from API data goes in data fields only, never in the summary.
- Tool descriptions: first line is the cost and pool; say which tool to call first; never describe a field the tool does not return; under 1,000 characters; static (never built from API data).
- Config comes from environment variables, validated at start-up (`loadCoreConfig`). Config errors name the variable, never its value.
- Log every tool call with tool, connection id, key fingerprint, pool, credits estimated, latency and outcome. Never log personal data from arguments or results.
- Conventional commits. Update `docs/tools.md` whenever a tool changes.

## API keys and tokens (top security requirement)

- An API key exists in plaintext only inside the request that uses it. It goes in the `api-key` header to the Partner API and nowhere else.
- Never put a key in a URL, log line, error message, trace, tool result or anything sent to the AI client. Never accept `?apikey=`.
- Log `keyFingerprint(apiKey)` (first 12 hex of SHA-256) instead. ESLint blocks `apiKey`, `key`, `token` (and similar) inside logging calls.
- The OAuth access token never reaches the Partner API (no token passthrough).
- Stored keys: AES-256-GCM envelope encryption with a KMS-managed key. Access/refresh tokens: opaque `boldmcp_` + 256-bit random, only SHA-256 hashes stored.
- The test key lives only in the environment as `BOLD_TEST_API_KEY` (CI: repository secret). `npm run check:secrets` fails if its first 8 characters appear in any file; CI also scans history. Fixtures are scrubbed when recorded.

## Credits

- Three pools: data, contact, KYB. The Partner API deducts credits exactly as today; the server only decides whether a call may go ahead.
- Before a paid call: worst-case cost → pool balance (Credit Usage, cached 60 s per key) → per-call limit (default 150) → otherwise elicitation or `status: "confirmation_required"` with a signed, single-use, 10-minute `confirmation_token`. Unlock tools always need confirmation.
- Never auto-paginate a paid tool. Retry at most twice (429, 5xx, timeout); failed or empty calls are never charged.

## Testing and budget

- `npm run lint && npm run typecheck && npm test && npm run build` must pass before every commit.
- Contract tests run against `test/fixtures` through msw (`test/msw/handlers.ts`). Recorded staging fixtures in `test/fixtures/recorded/` override synthetic ones in `test/fixtures/synthetic/`.
- Live calls use the test key with `page_size` 1–2, each contact/KYB unlock endpoint at most once per run, and `credit-usage-logs` checked after every run. Job budget: 2,000 data, 100 contact, 100 KYB credits in total; track spending in `docs/api-notes.md` under "Live test spend".

## Process

- Milestones M0–M5 in order, one stacked branch and PR each (`m0-setup`, `m1-core-free-tools`, …). PR body: what was built, test results, credits spent by pool, `docs/api-notes.md` additions.
- Never merge to `main`, deploy to production, publish to npm or submit to a directory without explicit approval. Anything needing cloud accounts, DNS, KMS or a secrets manager uses local stand-ins behind interfaces until provided.
