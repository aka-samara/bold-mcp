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
```

Status: M1 — 9 free tools over header-mode HTTP (`/mcp`) and stdio. Paid tools arrive in M2. See `docs/clients/claude-code.md` to connect.
