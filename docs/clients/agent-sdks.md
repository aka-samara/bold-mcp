# Agent SDKs and APIs

Server-side agents use header mode: pass the customer's API key as a bearer token. Keep the key in your secrets store; never put it in a prompt.

## Claude Agent SDK (TypeScript)

```ts
import { query } from "@anthropic-ai/claude-agent-sdk";

for await (const msg of query({
  prompt: "Top US importers of HS 940360, free tools first.",
  options: {
    mcpServers: {
      bold: { type: "http", url: "https://mcp.billofladingdata.com/mcp", headers: { Authorization: `Bearer ${process.env.BOLD_API_KEY}` } },
    },
    allowedTools: ["mcp__bold__get_market_insights", "mcp__bold__search_products", "mcp__bold__find_company_id"],
  },
})) console.log(msg);
```

Allow paid and unlock tools only where a person reviews `confirmation_required` results.

## Claude API (MCP connector)

Use the Messages API MCP connector with `"type": "url"`, `"url": "https://mcp.billofladingdata.com/mcp"` and the API key as `authorization_token`. See Anthropic's MCP connector docs for the current beta header and tool configuration.

## OpenAI Responses API

```json
{
  "type": "mcp",
  "server_label": "bold",
  "server_url": "https://mcp.billofladingdata.com/mcp",
  "headers": { "Authorization": "Bearer BOLD_API_KEY" },
  "require_approval": "always"
}
```

## Python MCP client

```python
from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client

async with streamablehttp_client("https://mcp.billofladingdata.com/mcp", headers={"Authorization": f"Bearer {key}"}) as (r, w, _):
    async with ClientSession(r, w) as s:
        await s.initialize()
        print(await s.call_tool("get_credit_balance", {}))
```
