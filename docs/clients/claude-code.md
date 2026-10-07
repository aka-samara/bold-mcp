# Claude Code

## Header mode (remote server)

```sh
claude mcp add --transport http bold https://mcp.billofladingdata.com/mcp \
  --header "Authorization: Bearer YOUR_API_KEY"
```

Staging: use `https://mcp-staging.billofladingdata.com/mcp`. Local development: `http://localhost:3000/mcp`.

Optional spending headers (credits):

```sh
  --header "X-Bold-Max-Credits: 150" \
  --header "X-Bold-Daily-Credits: 2000" \
  --header "X-Bold-Allow-Contacts: false" \
  --header "X-Bold-Allow-KYB: false"
```

## Local (stdio) package

```sh
claude mcp add bold --env BOLD_API_KEY=YOUR_API_KEY -- npx -y @billofladingdata/mcp
```

Optional: `BOLD_MAX_CREDITS`, `BOLD_DAILY_CREDITS`, `BOLD_ALLOW_CONTACTS=false`, `BOLD_ALLOW_KYB=false`.

## Try it

Ask: "Using Bill of Lading Data, how big is the US import market for HS 940360 over the last 12 months?" Claude should call `search_products` and `get_market_insights` (both free).

## Run the server locally against the mock API

```sh
npm ci && npm run build
npm run dev:mock-api &                                   # http://127.0.0.1:4010/partner-api
BOLD_API_BASE_URL=http://127.0.0.1:4010/partner-api npm run start:http
claude mcp add --transport http bold-local http://localhost:3000/mcp --header "Authorization: Bearer any-test-key-000000"
```
