# Claude Code

## Sign in (paste your key)

```sh
claude mcp add --transport http bold https://mcp.billofladingdata.com/mcp
```

Then run `/mcp` in Claude Code, pick `bold` and choose **Authenticate**. Your browser opens the Bill of Lading Data page: paste the key, choose **Connect**, and return to the terminal.

## Header mode (remote server, key on your machine)

```sh
claude mcp add --transport http bold https://mcp.billofladingdata.com/mcp \
  --header "Authorization: Bearer YOUR_API_KEY"
```

Optional spending headers (credits):

```sh
  --header "X-Bold-Max-Credits: 150" \
  --header "X-Bold-Daily-Credits: 2000" \
  --header "X-Bold-Allow-Contacts: false" \
  --header "X-Bold-Allow-KYB: false"
```

Add `--scope project` to share the server (without a key: use sign-in or an environment variable such as `--header "Authorization: Bearer ${BOLD_API_KEY}"` in `.mcp.json`) with your team.

## Local (stdio) package

```sh
claude mcp add bold --env BOLD_API_KEY=YOUR_API_KEY -- npx -y @billofladingdata/mcp
```

Optional: `BOLD_MAX_CREDITS`, `BOLD_DAILY_CREDITS`, `BOLD_ALLOW_CONTACTS=false`, `BOLD_ALLOW_KYB=false`.

Staging: use `https://mcp-staging.billofladingdata.com/mcp`. Local development: `http://localhost:3000/mcp`.

## Try it

Ask: "Using Bill of Lading Data, how big is the US import market for HS 940360 over the last 12 months?" Claude should call `search_products` and `get_market_insights` (both free).

## Run the server locally against the mock API

```sh
npm ci && npm run build
npm run dev:mock-api &                                   # http://127.0.0.1:4010/partner-api
BOLD_API_BASE_URL=http://127.0.0.1:4010/partner-api npm run start:http
claude mcp add --transport http bold-local http://localhost:3000/mcp --header "Authorization: Bearer any-test-key-000000"
```
