# Cursor

Edit `~/.cursor/mcp.json` (all projects) or `.cursor/mcp.json` (one project), or use **Settings → MCP → Add new MCP server**.

**Sign in (paste your key)** — Cursor opens the Bill of Lading Data page the first time; choose **Login** next to the server in Settings → MCP if it doesn't.

```json
{
  "mcpServers": {
    "bold": { "url": "https://mcp.billofladingdata.com/mcp" }
  }
}
```

**Header mode** — keep the key in an environment variable rather than in the file:

```json
{
  "mcpServers": {
    "bold": {
      "url": "https://mcp.billofladingdata.com/mcp",
      "headers": { "Authorization": "Bearer ${env:BOLD_API_KEY}" }
    }
  }
}
```

**Local (stdio)**

```json
{
  "mcpServers": {
    "bold": { "command": "npx", "args": ["-y", "@billofladingdata/mcp"], "env": { "BOLD_API_KEY": "${env:BOLD_API_KEY}" } }
  }
}
```

Staging: `https://mcp-staging.billofladingdata.com/mcp`.
