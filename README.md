# bold-mcp

MCP server that lets Bill of Lading Data customers use the global Partner API inside ChatGPT, Claude and other AI tools with their existing API key. See `docs/BRIEF.md` for the spec and `CLAUDE.md` for conventions.

```sh
npm ci
npm run lint && npm run typecheck && npm test && npm run build
npm run check:secrets          # needs BOLD_TEST_API_KEY in the environment
npm run gate:m0                # live: test key works against BOLD_API_BASE_URL
npm run fixtures:record        # live: record free-endpoint fixtures (0 credits)
npm run check:inspector        # MCP Inspector CLI against built stdio + HTTP servers
npm run dev:mock-api           # local Partner API stand-in on :4010
npm run smoke:mock             # every tool + credit reconciliation against the mock
npm run smoke:live -- --paid   # live: every tool once, page_size 1, reconcile with Credit Usage Logs
docker compose up -d postgres redis   # local Postgres and Redis for the HTTP server
npm run test:integration       # store tests (set TEST_DATABASE_URL and TEST_REDIS_URL)
npm run test:browser           # connect page in Chromium
npm run admin -- migrate | expire-unused | revoke-fingerprint <fp>
```

Run the HTTP server locally with sign-in: copy `.env.example` to `.env`, fill `BOLD_LOCAL_KMS_KEY`, start Postgres and Redis, then `npm run build && node --env-file=.env packages/http-server/dist/index.js`. Container image: `docker build -f infra/Dockerfile .` Load test: `npm run load:k6` (k6, see `infra/load/mcp-load.js`).

Status: M4 — all 18 tools (9 free, 7 paid, 2 unlocks that always ask) with the credit guard and an unlock audit log, over stdio and HTTP (`/mcp`) with either a key in the Authorization header or OAuth paste-your-key sign-in (connect page, encrypted key vault, Postgres, Redis). Security review: `docs/security-review.md`. Client setup: `docs/clients/`. See `docs/clients/claude-code.md` to connect.
