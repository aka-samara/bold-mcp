# Monitoring

| Brief item | Where it comes from |
| --- | --- |
| Tool calls by tool | `bold_tool_calls_total` (tool, outcome, auth_mode) |
| Tool calls by client | `usage_log` joined to `connections.client_name` (see queries below) |
| Credits by tool and pool | `bold_credits_used_total`; by key fingerprint from `usage_log` |
| Error rate | `bold_tool_calls_total{outcome=~"tool_error\|exception"}` |
| p50 / p95 latency | `bold_tool_call_duration_seconds`, `bold_token_duration_seconds` |
| Connect-page success rate | `bold_connect_attempts_total` (success, success_zero_balance, wrong_key, csrf, rate_limited, check_failed) |
| Active connections / sessions | `bold_active_sessions`; connections from SQL |
| Upstream rate-limit hits | `bold_rate_limited_total` (scope) |
| Unlocks | `bold_unlocks_total`; details in `unlock_audit` |

Files:

- `alerts.yml`: Prometheus alert rules for the brief's alerts that metrics can express.
- `dashboard.json`: Grafana dashboard (import, pick the Prometheus data source).
- Jobs (schedule with the host's scheduler, alert on a non-zero exit):
  - nightly `node packages/http-server/dist/admin.js reconcile --hours 24` (estimate vs Credit Usage Logs mismatch);
  - hourly `node packages/http-server/dist/admin.js spend-check --hours 1 --limit 5000` (any key spending more than 5,000 credits in an hour through MCP);
  - weekly `node packages/http-server/dist/admin.js report --days 7` (new connections, active keys, credits by pool, top tools, top failures), mailed or posted by the scheduler.

Useful SQL:

```sql
-- Tool calls by client, last 24 h
SELECT COALESCE(c.client_name, u.auth_mode) AS client, COUNT(*) FROM usage_log u
LEFT JOIN connections c ON c.id = u.connection_id
WHERE u.created_at > now() - interval '24 hours' GROUP BY 1 ORDER BY 2 DESC;

-- Active connections
SELECT COUNT(*) FROM connections WHERE revoked_at IS NULL AND invalid_at IS NULL AND last_used_at > now() - interval '30 days';
```
