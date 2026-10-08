# Load test results

`infra/load/mcp-load.js` (k6 1.3.0), 2026-10-08, one server instance from `npm run build` with local Postgres 16 and Redis 7, against the local mock Partner API (so request time is the server's own overhead). Hardware: the build container (shared cloud VM).

| Measure | Result | Target (brief) |
| --- | --- | --- |
| Connections | 50 concurrent, header mode, own key and client IP each | 50 |
| Duration | 10 minutes | 10 minutes |
| Requests | 29,969 (≈ 50 per second) | — |
| Tool call p95 | **6.1 ms** (p50 3.6 ms, max 220 ms) | < 300 ms overhead |
| HTTP failures | 0 | — |
| Tool errors | 106 of 29,869 (0.36%), all the per-connection limit of 60 calls a minute: the script paced at 0.8–1.2 s, so some fixed one-minute windows saw 61 calls. Pacing is now 1.0–1.4 s. | — |

Still to do before launch: the same run against staging (free tools only, so no credits), with two or more instances behind the load balancer.
