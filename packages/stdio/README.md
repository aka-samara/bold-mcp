# @billofladingdata/mcp

Bill of Lading Data MCP server for local use (stdio). Gives AI tools such as Claude Code, Cursor and VS Code the 18 Bill of Lading Data tools, using your own API key and your account's credits.

```sh
BOLD_API_KEY=YOUR_API_KEY npx -y @billofladingdata/mcp
```

Claude Code: `claude mcp add bold --env BOLD_API_KEY=YOUR_API_KEY -- npx -y @billofladingdata/mcp`

Optional settings: `BOLD_MAX_CREDITS` (per-call limit before asking, default 150), `BOLD_DAILY_CREDITS` (default 2000), `BOLD_ALLOW_CONTACTS=false`, `BOLD_ALLOW_KYB=false`. Contact and KYB unlocks always ask first.

Knowledge tools (optional): set `BOLD_KNOWLEDGE_URL` and `BOLD_KNOWLEDGE_TOKEN` (from Bill of Lading Data) to add 12 free tools that answer questions about Bill of Lading Data itself: coverage, prices and plans, terms and the API.

Prefer not to keep a key on your machine? Use the hosted server at `https://mcp.billofladingdata.com/mcp` and sign in with your key in the browser.
