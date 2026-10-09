# Partner API notes

Differences between `docs/BRIEF.md` and the live Partner API, and anything else learned from live calls. Where the brief and the live API disagree, the live API wins; each entry is raised with the Bill of Lading Data team.

Status key: **open** (needs the team), **confirmed** (checked live), **assumed** (not yet checked live).

## Base URL and access

| # | Topic | Status | Note |
| --- | --- | --- | --- |
| 1 | Base URL for the test key | open | Brief input #2 is open. Default is `https://tradedata.billofladingdata.com/partner-api`; override with `BOLD_API_BASE_URL`. The M0 gate (`npm run gate:m0`) has not run yet: the build environment had no test key and its network policy blocked `tradedata.billofladingdata.com` (7 Oct 2026). |

## Response shapes

| # | Topic | Status | Note |
| --- | --- | --- | --- |
| 2 | Envelope | assumed | Every path returns `{ code, message, data }` (brief). Contract tests enforce this on fixtures; recording will fail loudly if a path differs. |
| 3 | List payloads | assumed | The brief does not give the paging wrapper. Synthetic fixtures use `data: { total, list: [...] }` as a placeholder. Replace with the recorded shape before M1 schemas are finalised. |
| 4 | KYB Search payload | assumed | Brief says an array of `{id, name, registration_number, vat_number, country_code, state, jurisdiction}`; synthetic fixture uses a bare array as `data`. |
| 5 | Error bodies | assumed | Brief lists 200, 400, 401, 402, 403, 404, 500 and no 429. Error messages in synthetic fixtures are placeholders. The recorder captures a real 401 with a deliberately invalid key (free endpoint). |
| 6 | Products field descriptions | known | The docs copy Competitors' response field descriptions into Products; ignore them (brief). |

## Billing

| # | Topic | Status | Note |
| --- | --- | --- | --- |
| 7 | KYB Search pool | assumed | Team says 3 credits per search; pool assumed KYB. Confirm in Credit Usage Logs on the first paid recording run. |
| 8 | `credit_type` / `action` values in Credit Usage Logs | open | Needed to reconcile estimates per tool. Capture from the first recording run. |

## Live test spend

Budget for the whole job: 2,000 data · 100 contact · 100 KYB credits.

| Date | Run | Data | Contact | KYB | Source |
| --- | --- | --- | --- | --- | --- |
| — | No live runs yet | 0 | 0 | 0 | — |
| | **Total** | **0** | **0** | **0** | |
