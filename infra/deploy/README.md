# Deploying bold-mcp

One Docker image (`infra/Dockerfile`) runs staging and production. Each environment needs its own Postgres, Redis, KMS key and secrets. Nothing here has been deployed: the hosting account, DNS and KMS are the team's to create (brief, "Inputs needed" #4).

## What each environment needs

| Item | Staging | Production |
| --- | --- | --- |
| Public URL | `https://mcp-staging.billofladingdata.com` | `https://mcp.billofladingdata.com` |
| Container platform | 1+ instance | 2+ instances behind a load balancer, autoscaling, zero-downtime deploys |
| Postgres 14+ | small managed instance | managed, daily backups |
| Redis 7+ | small managed instance | managed, shared by all instances |
| KMS key | symmetric key (encrypt/decrypt) | separate key |
| Secrets manager | entries below | separate entries |
| Load balancer | TLS, HTTP/1.1 streaming allowed (SSE), idle timeout ≥ 300 s, sticky on `Mcp-Session-Id` header | same, plus WAF allow-list for Claude (`160.79.104.0/21`) and ChatGPT egress ranges |

## Environment variables

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` (both environments; turns on the strict config checks) |
| `BOLD_PUBLIC_URL` | public origin, no path |
| `BOLD_API_BASE_URL` | Partner API base URL (default `https://tradedata.billofladingdata.com/partner-api`) |
| `DATABASE_URL` | Postgres connection string (use `sslmode=require`) |
| `REDIS_URL` | `rediss://…` |
| `BOLD_CONFIRMATION_SECRET`, `BOLD_CSRF_SECRET` | 32+ random characters each, from the secrets manager |
| `BOLD_KMS_PROVIDER` + KMS settings | cloud KMS adapter (added when the platform is chosen; `local` is refused in production) |
| `BOLD_TRUST_PROXY_HOPS` | `1` behind one load balancer |
| `BOLD_METRICS_PORT` | e.g. `9464`, scraped privately, never exposed publicly |
| `LOG_LEVEL` | `info` |

## Steps (staging)

1. Create Postgres, Redis, a KMS key and the secrets above.
2. Build and push the image: `docker build -f infra/Dockerfile -t REGISTRY/bold-mcp:VERSION .`
3. Run migrations once: `docker run --rm -e DATABASE_URL=… REGISTRY/bold-mcp:VERSION node packages/http-server/dist/admin.js migrate` (the server also applies them at start).
4. Deploy the service on port 8080 with the variables above; health check `GET /healthz`.
5. Point `mcp-staging.billofladingdata.com` at the load balancer with a TLS certificate.
6. Schedule daily: `node packages/http-server/dist/admin.js expire-unused` and `node packages/http-server/dist/admin.js reconcile --hours 24` (alert on a non-zero exit). Weekly: `node packages/http-server/dist/admin.js report --days 7`.
7. Check: `curl https://mcp-staging.billofladingdata.com/.well-known/oauth-protected-resource`, then connect from Claude Code (`docs/clients/claude-code.md`) and run `npm run smoke:live -- --paid --unlocks` with `BOLD_API_BASE_URL` set to the staging Partner API.

Production repeats these steps with its own resources, after approval.

## Revoking access

- A leaked customer key: `admin.js revoke-fingerprint <fingerprint>` (the fingerprint is in the logs and the audit log).
- All sessions of one connection: the user removes the connector, or `/revoke` with its token.
