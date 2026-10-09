# Partner API notes

Differences between `docs/BRIEF.md` and the live Partner API, and anything else learned from live calls. Where the brief and the live API disagree, the live API wins; each entry is raised with the Bill of Lading Data team.

Status key: **open** (needs the team), **confirmed** (checked live), **assumed** (not yet checked live).

## Base URL and access

| # | Topic | Status | Note |
| --- | --- | --- | --- |
| 1 | Base URL for the test key | confirmed | The test key works against `https://tradedata.billofladingdata.com/partner-api` (M0 gate passed 9 Oct 2026: Credit Usage and Credit Usage Logs both 200). The key is sent only in the `api-key` header (see decisions D46). Override with `BOLD_API_BASE_URL`. |

## Response shapes

| # | Topic | Status | Note |
| --- | --- | --- | --- |
| 2 | Envelope | confirmed | All 17 recorded paths return `{ code, message, data }`. Errors return `{ code, message }` with no `data`, for example `{ "code": 404, "message": "Company not found" }`. |
| 3 | List payloads | confirmed | Paged paths return `data: { page_no, page_size, total, records: [...] }`. Countries are objects `{ name, code, name_cn }` (code can be the string `"null"` for UNKNOWN); company lists give `import_countries`, `export_countries`, `loading_ports` and `unloading_ports` rather than `countries`/`ports`. Shipping records use `country_imp`/`country_exp` (+ `_en`, `_cn`), `start_port`/`end_port`, `manifest_units`, a record `id`, and numeric `amount`, `weight` and `bydate` (`YYYYMMDD`). Contact ids are numbers; the contact teaser has `*_count` fields plus arrays of email domains. Contact Look Up returns `current_title`, `current_employer` and emails as `{ email, smtp_valid, type, grade }`. The tools now read all of these (tested in `test/contract/recorded.test.ts`). |
| 4 | KYB Search payload | open | Not seen yet. On 9 Oct 2026 KYB Search returned 404 "Company not found" for every `company_id` + `type` tried (Samsung VN and KR, Walmart US, Tesco GB, two others), and 403 "Request failed with status code 403" for every `company_name` + `country_code` (Samsung KR, Walmart US, Tesco GB). No KYB credits were charged. Without a `kyb_id` the four KYB report sections could not be tested. Needs the team: is KYB enabled for the test key, and is the 403 an upstream registry error? |
| 5 | Error bodies | confirmed (401, 403, 404) | A real 401 is recorded in `test/fixtures/recorded/_errors.json`. The 403 and 404 bodies are in item 4. 400, 402 and 500 are still synthetic. |
| 6 | Products field descriptions | known | The docs copy Competitors' response field descriptions into Products; ignore them (brief). |

## Protocol

| # | Topic | Status | Note |
| --- | --- | --- | --- |
| 9 | MCP 2026-07-28 | open | The brief targets MCP spec 2026-07-28; the latest official SDK (1.32.1) supports up to 2025-11-25 (see decisions D10). Not an API difference; recorded here so it is raised with the team. |

## Billing

| # | Topic | Status | Note |
| --- | --- | --- | --- |
| 7 | KYB Search pool | open | Still unconfirmed: no KYB Search call succeeded (item 4), and failed calls charged nothing. |
| 8 | `credit_type` / `action` values in Credit Usage Logs | confirmed | `credit_type` is `data_credits`, `contact_credits` or `kyb_credits`. Actions seen: `shipping_record_view` (1 per record), `company_record_view` (15 per company, for All Importers, All Exporters, Company Search and Competitors), `company_profile_view` (20, Company Details), `advanced_contact_search` (2, Contacts Pro) and `professional_email_lookup` (10). Credit Usage also counts `personal_email_lookups`, `phone_lookups`, `search_kyb`, `financial_kyb`, `share_holder_kyb` and `officer_kyb`. Every charge matched the cost table. Older entries on this account show `company_record_view` at 45 credits (8 Oct, before this job); these are probably pages of 3 records. |

## Live test spend

Budget for the whole job: 2,000 data · 100 contact · 100 KYB credits.

| Date | Run | Data | Contact | KYB | Source |
| --- | --- | --- | --- | --- | --- |
| 2026-10-09 | M0 gate, free fixture recording, free probes | 0 | 0 | 0 | credit-usage-logs |
| 2026-10-09 | `fixtures:record --paid --unlocks` (company samsung) | 81 | 12 | 0 | credit-usage-logs |
| 2026-10-09 | `smoke:live --paid --unlocks` (company samsung) | 81 | 12 | 0 | credit-usage-logs |
| | **Total** | **162** | **24** | **0** | Budget left: 1,838 / 76 / 100 |
