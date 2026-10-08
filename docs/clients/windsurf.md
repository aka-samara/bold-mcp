# Windsurf

Edit `~/.codeium/windsurf/mcp_config.json` (or **Windsurf Settings → Cascade → MCP servers → View raw config**), then refresh the server list.

```json
{
  "mcpServers": {
    "bold": {
      "serverUrl": "https://mcp.billofladingdata.com/mcp",
      "headers": { "Authorization": "Bearer ${env:BOLD_API_KEY}" }
    }
  }
}
```

Local (stdio):

```json
{
  "mcpServers": {
    "bold": { "command": "npx", "args": ["-y", "@billofladingdata/mcp"], "env": { "BOLD_API_KEY": "YOUR_API_KEY" } }
  }
}
```
