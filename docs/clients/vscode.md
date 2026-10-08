# VS Code (GitHub Copilot agent mode)

Add to `.vscode/mcp.json` in a workspace, or run **MCP: Open User Configuration** for all workspaces. Then open Copilot Chat in **Agent** mode and enable the Bill of Lading Data tools.

**Sign in (paste your key)** — VS Code asks to sign in and opens the Bill of Lading Data page:

```json
{
  "servers": {
    "bold": { "type": "http", "url": "https://mcp.billofladingdata.com/mcp" }
  }
}
```

**Header mode** — VS Code prompts for the key once and stores it securely:

```json
{
  "inputs": [
    { "type": "promptString", "id": "bold-api-key", "description": "Bill of Lading Data API key", "password": true }
  ],
  "servers": {
    "bold": {
      "type": "http",
      "url": "https://mcp.billofladingdata.com/mcp",
      "headers": { "Authorization": "Bearer ${input:bold-api-key}" }
    }
  }
}
```

**Local (stdio)**

```json
{
  "inputs": [
    { "type": "promptString", "id": "bold-api-key", "description": "Bill of Lading Data API key", "password": true }
  ],
  "servers": {
    "bold": { "type": "stdio", "command": "npx", "args": ["-y", "@billofladingdata/mcp"], "env": { "BOLD_API_KEY": "${input:bold-api-key}" } }
  }
}
```

Staging: `https://mcp-staging.billofladingdata.com/mcp`.
