# Client setup

Two ways to connect, both with the customer's own Bill of Lading Data API key:

- **Sign in (paste your key)**: add the server URL; the client opens a Bill of Lading Data page where you paste your key and pick spending settings. The key is stored encrypted on the server; the client only gets a revocable token. Works in Claude (web, desktop, mobile), ChatGPT, Claude Code, Cursor, VS Code and other clients with MCP OAuth.
- **Header mode**: the client sends `Authorization: Bearer YOUR_API_KEY` on every request; nothing is stored on the server. For clients that let you set headers (Claude Code, Cursor, VS Code, Windsurf, Gemini CLI, agent SDKs).
- **Local (stdio)**: `npx -y @billofladingdata/mcp` with `BOLD_API_KEY` set (after the npm package is published).

| Server | URL |
| --- | --- |
| Production | `https://mcp.billofladingdata.com/mcp` |
| Staging | `https://mcp-staging.billofladingdata.com/mcp` |
| Local development | `http://localhost:3000/mcp` |

Pages: [Claude (web, desktop, mobile)](claude.md) · [ChatGPT](chatgpt.md) · [Claude Code](claude-code.md) · [Cursor](cursor.md) · [VS Code](vscode.md) · [Windsurf](windsurf.md) · [Gemini CLI](gemini-cli.md) · [Agent SDKs and APIs](agent-sdks.md)

**Spending settings.** Sign-in: chosen on the connect page. Header mode: `X-Bold-Max-Credits` (per-call limit, default 150), `X-Bold-Daily-Credits` (default 2,000), `X-Bold-Allow-Contacts: false`, `X-Bold-Allow-KYB: false`. Stdio: `BOLD_MAX_CREDITS`, `BOLD_DAILY_CREDITS`, `BOLD_ALLOW_CONTACTS`, `BOLD_ALLOW_KYB`. Contact and KYB unlocks always ask first, whatever the settings.

**Check it works.** Ask: "Using Bill of Lading Data, who are the top US importers of HS 940360?" The AI should start with free tools (`get_market_insights`), then ask before a paid list.

UI labels in AI clients change often; if a menu name below differs, look for "Connectors", "MCP" or "Tools" in the client's settings.
