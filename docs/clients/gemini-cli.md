# Gemini CLI

Add to `~/.gemini/settings.json` (or `.gemini/settings.json` in a project):

```json
{
  "mcpServers": {
    "bold": {
      "httpUrl": "https://mcp.billofladingdata.com/mcp",
      "headers": { "Authorization": "Bearer $BOLD_API_KEY" }
    }
  }
}
```

Or, to sign in with your key in the browser instead, leave out `headers` and run `/mcp auth bold` inside Gemini CLI.

Local (stdio): `"bold": { "command": "npx", "args": ["-y", "@billofladingdata/mcp"], "env": { "BOLD_API_KEY": "$BOLD_API_KEY" } }`.
