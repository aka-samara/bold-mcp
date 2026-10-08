# Handover: what's built, what's tested, what needs you

State on 8 Oct 2026. Branch chain: `m0-setup` → `m1-core-free-tools` → `m2-paid-tools` → `m3-oauth-signin` → `m4-unlocks-hardening` → `m5-launch-prep`, each stacked on the one before. `main` holds only an empty first commit. Nothing is deployed, published or submitted.

## 1. Pull requests

None are open yet. This build environment has no GitHub account linked, so the six branches exist only in the local repo and the copy in the project files (`bold-mcp/`). When GitHub is connected and an empty `bold-mcp` repo exists, I push the six branches and open one PR per milestone, each based on the branch before it. PR bodies use the summaries below.

| PR | Base | What it builds |
| --- | --- | --- |
| M0 setup | `main` | Monorepo, CI (lint, typecheck, tests, build, Inspector, key-leak check with history scan, `npm audit`), config validation, synthetic fixtures for all 22 paths, fixture recorder, `docs/` |
| M1 core and free tools | M0 | API client (api-key header, timeouts, 2 retries, error mapping), shaping, 9 free tools, resources, prompts, server instructions, local rate limits, stdio package, header-mode `/mcp` |
| M2 paid tools | M1 | 7 paid tools, cost table, pool balances from Credit Usage, credit guard (elicitation or signed single-use confirmation tokens), per-call and daily limits, credits used and remaining in every result |
| M3 sign-in | M2 | OAuth metadata, DCR, CIMD, `/authorize` connect page, `/token`, `/revoke`, encrypted key vault (KMS interface), Postgres, Redis, admin CLI, Dockerfile, CI service containers, browser tests, image scan |
| M4 unlocks and hardening | M3 | `reveal_contact_details`, `get_kyb_report` (always confirmed, allow switches, audit log), security review with 5 fixes, k6 load test, setup docs for every client |
| M5 launch prep | M4 | Metrics, alert rules, dashboard, reconcile / spend-check / report jobs, `server.json`, bundled stdio package, deploy guide, listing drafts |

## 2. Test report and credits spent

| Suite | Result |
| --- | --- |
| Unit, contract, protocol, HTTP, OAuth, Postgres + Redis integration, admin CLI, Chromium connect page | **276 passed**, 25 files (Postgres 16 and Redis 7 run locally) |
| MCP Inspector CLI (stdio and HTTP) | passed, 18 tools, 6 prompts |
| Smoke run of all 18 tools against the charging mock API | passed; server estimates match the mock's Credit Usage Logs: data 81, contact 12, KYB 43 |
| Key safety (every tool, every error path, OAuth flow; logs, results, upstream bodies) | no key or token found |
| Packed stdio package (`npm pack`, install, run) | starts, lists 18 tools |
| Load: 50 connections, 10 minutes (k6) | p95 6.1 ms, 0 HTTP failures (`docs/load-test.md`) |
| `npm audit --audit-level=high` | 0 findings |
| `server.json` against registry schema 2025-12-11 | valid |

**Credits spent: data 0, contact 0, KYB 0.** No live call has been possible. This environment has no `BOLD_TEST_API_KEY`, and its network policy blocks `tradedata.billofladingdata.com`. The live checks are ready to run once both are fixed. Planned spend is about 81 data, 12 contact and 43 KYB credits per full run (`npm run smoke:live -- --paid --unlocks`), within the 2,000 / 100 / 100 budget for one run.

Not yet verified (needs the key, staging or the user):

- the M0 gate (key works against the base URL);
- recorded fixtures;
- the live smoke and reconciliation;
- client end-to-end checks in Claude, ChatGPT, Cursor and VS Code;
- the load test against staging.

## 3. What needs you

Do these in order: the first two unblock everything live.

1. **Rotate the test key.** The key was pasted into the job prompt by mistake (the prompt shows a key-shaped value where the variable name should be).
   1. In your Bill of Lading Data account, create a new API key with data, contact and KYB credits.
   2. Revoke the old one.
2. **Let the build environment reach the API with the key.**
   1. This project runs on a built-in environment with no settings, so it needs its own. Open Project settings → Environment, open the Cloud environment menu and choose **Add cloud environment**. A shared project picks an environment shared with the organisation instead.
   2. Under Network access, choose Limited, add `tradedata.billofladingdata.com` to Allowed domains, and keep "Allow package managers" ticked. Steps: https://code.claude.com/docs/en/cloud-environments#network-access.
   3. In the same dialog, add the environment variable `BOLD_TEST_API_KEY` with the new key.
   4. Optional: add `BOLD_API_BASE_URL` if a staging Partner API exists.
   5. Tell me it's done. Sessions started after that run on the new environment, and I then run the M0 gate, record fixtures, and run the live smoke with reconciliation.
3. **GitHub.**
   1. Connect GitHub at https://claude.ai/connect-github.
   2. Create an empty repo named `bold-mcp` in your organisation, with no README.
   3. Install the Claude GitHub app on it: https://github.com/apps/claude/installations/select_target.
   4. Add the repository secret `BOLD_TEST_API_KEY` (Settings → Secrets and variables → Actions). The CI key-leak check uses it.
   5. Tell me the owner/repo. I push the six branches and open the stacked PRs.
4. **Hosting for staging (brief input #4).**
   1. Pick a platform (Cloud Run, ECS/Fargate or Fly.io).
   2. Create managed Postgres, Redis, a KMS key and secrets for `BOLD_CONFIRMATION_SECRET` and `BOLD_CSRF_SECRET`.
   3. Add a DNS record `mcp-staging.billofladingdata.com` pointing at its load balancer.
   4. Give me access, or deploy yourself with `infra/deploy/README.md`.
   5. I add the KMS adapter for the platform you choose (`LocalKms` is refused in production).
5. **Privacy and terms (brief input #5).**
   1. Have legal update the privacy notice and terms to cover storing API keys for AI connections and sending results to the customer's AI provider.
   2. Sign off contact and KYB unlocks through AI tools. This is the M4 gate.
6. **Listing inputs (brief input #7).** Approve or edit `docs/listings/drafts.md`, and provide:
   - a support email;
   - privacy and terms URLs;
   - a separate reviewer test key.
7. **Beta (brief input #8).** Name 5–10 customers to test on staging, then production.
8. **Approvals I will wait for**, each as a separate yes:
   - merge to `main`;
   - production deploy;
   - npm publish of `@billofladingdata/mcp`, which needs an npm org `billofladingdata` and a publish token;
   - MCP Registry submission, which needs a DNS TXT record on `billofladingdata.com` for the `com.billofladingdata` namespace;
   - Claude Connectors Directory submission;
   - ChatGPT app directory submission.

## 4. Connect the staging server

These steps work once staging is deployed at `https://mcp-staging.billofladingdata.com/mcp`. Full pages are in `docs/clients/`.

**Claude (web or desktop)**
1. Open Settings → Connectors → Add custom connector.
2. Name: `Bill of Lading Data (staging)`. URL: `https://mcp-staging.billofladingdata.com/mcp`.
3. Choose Connect, paste your key on the Bill of Lading Data page, and choose Connect again.

**ChatGPT**
1. Open Settings → Apps & Connectors → Advanced settings and turn on Developer mode.
2. Choose Create. Name: `Bill of Lading Data (staging)`. MCP server URL: `https://mcp-staging.billofladingdata.com/mcp`. Authentication: OAuth.
3. Choose Create, paste your key on the connect page, and choose Connect.
4. In a chat, choose + → Developer mode → Bill of Lading Data.

**Claude Code**
```sh
claude mcp add --transport http bold-staging https://mcp-staging.billofladingdata.com/mcp
# then /mcp → bold-staging → Authenticate (paste key in the browser)
# or header mode:
claude mcp add --transport http bold-staging https://mcp-staging.billofladingdata.com/mcp --header "Authorization: Bearer YOUR_API_KEY"
```

**Cursor** (`~/.cursor/mcp.json`)
```json
{ "mcpServers": { "bold-staging": { "url": "https://mcp-staging.billofladingdata.com/mcp" } } }
```

**VS Code** (`.vscode/mcp.json`)
```json
{ "servers": { "bold-staging": { "type": "http", "url": "https://mcp-staging.billofladingdata.com/mcp" } } }
```

Before staging exists, the same setups work against a local server (`http://localhost:3000/mcp`, see `docs/clients/claude-code.md`).
