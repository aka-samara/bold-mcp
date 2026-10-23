# Tools

18 tools over the 22 global endpoint paths, plus 12 optional knowledge tools (below). This file is updated whenever a tool changes. Status: **planned** until the tool ships in its milestone.

| Tool | Endpoint(s) | Cost | Pool | Milestone | Status |
| --- | --- | --- | --- | --- | --- |
| `get_filter_options` | search-filters; shipping-filters (`include_parties=true`) | Free | — | M1 | shipped |
| `get_market_insights` | insights | Free | — | M1 | shipped |
| `search_products` | products | Free | — | M1 | shipped |
| `find_company_id` | company-search-free | Free | — | M1 | shipped |
| `check_logistics_company` | check-logistic-company | Free | — | M1 | shipped |
| `find_company_contacts` | company-contacts; advanced-company-contacts (`volume="pro"`) | Free; Pro 2 per page | Contact (Pro) | M1, Pro mode M2 | shipped |
| `get_credit_balance` | credit-usage | Free | — | M1 | shipped |
| `get_credit_history` | credit-usage-logs | Free | — | M1 | shipped |
| `estimate_cost` | local | Free | — | M1 | shipped |
| `search_shipments` | shipping-records | 1 per record | Data | M2 | shipped |
| `list_importers` | all-importers | 15 per record | Data | M2 | shipped |
| `list_exporters` | all-exporters | 15 per record | Data | M2 | shipped |
| `search_companies` | company-search | 15 per record | Data | M2 | shipped |
| `find_competitors` | competitors | 15 per record | Data | M2 | shipped |
| `get_company_profile` | company-details | 20 | Data | M2 | shipped |
| `search_kyb` | kyb-search | 3 per search | KYB | M2 | shipped |
| `reveal_contact_details` | contact-look-up | 10 / 10 / 15 per person | Contact | M4 | shipped |
| `get_kyb_report` | advanced-kyb-search, financial-kyb, shareholders-kyb, officers-kyb | 10 per section | KYB | M4 | shipped |

## Shared behaviour

- Every result has `source: "Bill of Lading Data"`, typed `structuredContent` matching the tool's `outputSchema`, and a one-line text summary that never quotes API data.
- Paged results carry `total`, `page_no`, `page_size`, `has_more` and `next_page_cost_credits`.
- Chinese labels (`*_cn`) are dropped unless `language: "zh"` (filter options, insights).
- Product text is cut to 200 characters with `products_truncated: true`.
- Filter option lists show at most 100 items each, with `total` and `truncated`.
- `find_company_id` rows use `company_id` (the API's `id`) so it chains into other tools.
- `find_company_contacts` rows use `contact_id`, never include `profile_pic`, and show `available` (counts of professional emails, personal emails and phones, plus `premium_phone_available`) instead of the details.
- Local limits: 60 tool calls a minute and 5 at once per connection; Company Search Free 30/min, 450/hr, 1,500/day and Contacts Lite 10/min, 150/hr, 25,000/month per key, with a message offering the paid alternative.

## Paid tools and the credit guard (M2)

- Paid tools take optional `max_credits` and `confirmation_token`, and every result carries `status` (`ok`, `confirmation_required`, `cancelled`), `pool`, `credits_used` (estimated from what was returned), `credits_used_is_estimate: true` and `credits_remaining` (pool balance refreshed after a charge). Per-record tools also give `next_page_cost_credits`.
- Before a paid call the server computes the worst case from `src/billing/costs.ts`, reads the pool balance from Credit Usage (cached 60 s per key) and:
  - refuses without calling the API if the worst case is more than the pool has left ("Not enough data credits — you have 20 left …");
  - asks the user when the worst case is above the per-call limit (default 150, or a lower `max_credits`), or would pass the connection's daily limit (default 2,000, all pools), and always for unlock tools;
  - asks through MCP elicitation when the client supports it, otherwise returns `status: "confirmation_required"` with a signed, single-use, 10-minute `confirmation_token` bound to the connection, tool and exact arguments.
- `find_company_contacts` with `volume: "pro"` calls Contacts Pro and charges 2 contact credits per non-empty page. Its annotation is not idempotent because of Pro mode.
- Header-mode spending settings: `X-Bold-Max-Credits`, `X-Bold-Daily-Credits`, `X-Bold-Allow-Contacts`, `X-Bold-Allow-KYB`. Stdio: `BOLD_MAX_CREDITS`, `BOLD_DAILY_CREDITS`, `BOLD_ALLOW_CONTACTS`, `BOLD_ALLOW_KYB`.
- `search_shipments` rows rename `import_id`/`export_id` to `import_record_id`/`export_record_id` and `bydate` to `date` (ISO), so record ids are never mistaken for company ids. The record's own `id` becomes `shipment_id`, and the live field names `country_imp`/`country_exp` (+ `_en`), `start_port`/`end_port` and `manifest_units` become `import_country`/`export_country` (+ `_name`), `loading_port`/`unloading_port` and `quantity_unit`.

## Unlock tools (M4)

- `reveal_contact_details` (`contact_id` from `find_company_contacts`, `lookup_type[]` of `professional_emails`, `personal_emails`, `phones`) and `get_kyb_report` (`kyb_id` from `search_kyb`, `sections[]` of `details`, `financials`, `shareholders`, `officers`, plus `page_size` ≤ 100 and `page_no` for shareholders and officers).
- Both **always** ask the user first (elicitation or `confirmation_token`), whatever the limits, and are refused outright when the connection's allow switch is off (connect page, `X-Bold-Allow-Contacts: false`, `X-Bold-Allow-KYB: false`, or `BOLD_ALLOW_CONTACTS=false` / `BOLD_ALLOW_KYB=false` for stdio). The worst case is the sum of the requested lookup types, or 10 × sections.
- Charged only for what comes back: `returned_types` / `returned_sections` list what was charged. A KYB section that fails is reported in `section_errors` and not charged; the other sections still return.
- Contact results never include `profile_pic`; officer rows never include date-of-birth fields. Financials become one table per statement (`group`, `years`, and rows of `item` plus a value per year).
- Revealed details appear only in `structuredContent`, never in the text summary or logs. Each unlock that returned data is written to the audit log (`unlock_audit`: connection, key fingerprint, contact or KYB id, what was unlocked, credits, time); `bold-mcp-admin audit` lists it.
- Annotated read-only, non-destructive, idempotent and open-world (brief), so ChatGPT treats them as reads; safety comes from the server's confirmation.

## Knowledge tools (M6, optional)

Free, read-only answers from the BOL sales assistant's knowledge base, so the AI can answer questions about Bill of Lading Data itself: coverage, prices, plans, terms, the API, policies and how to answer customers. They proxy the sales assistant's own knowledge tools (`POST {BOLD_KNOWLEDGE_URL}/api/kb/v1/tools/{name}`), so admin edits and team-saved corrections show up at once. Registered only when `BOLD_KNOWLEDGE_URL` and `BOLD_KNOWLEDGE_TOKEN` are both set; without them the server has its 18 tools.

| Tool | Answers | Cost |
| --- | --- | --- |
| `search_knowledge` | FAQs, objections, proof points, competitors, policies, products, coverage, pricing rules, data quality, qualification, escalation, never-promise rules, use cases, uploaded guides | Free |
| `resolve_countries` | Country names, aliases and regions to ISO codes | Free |
| `resolve_route` | Where a trade route's records come from (both sides, importer side, exporter side, not covered), freshness, open conflicts | Free |
| `get_coverage` | Direct and mirror coverage per country: history, latest month, update frequency, lag, channels, missing fields | Free |
| `get_field_gaps` | Key fields missing or partial per country | Free |
| `get_schema` | Data dictionary for one country and direction | Free |
| `get_volume` | Yearly record counts per country and direction (estimates) | Free |
| `get_packages` | API credit costs and packages, contact packs, dashboard plans, bulk HS4 and country dataset prices, enrichment rules | Free |
| `price_quote` | A calculated quote for API, dashboard, bulk or enrichment | Free |
| `get_terms` | Licence and reseller agreement clauses with plain summaries | Free |
| `get_api_reference` | Partner API endpoints, parameters, costs, limits | Free |
| `get_samples` | Which sample sheets exist (never the rows) | Free |

- Inputs mirror the sales assistant's schemas exactly (`npm run check:knowledge` compares them with the live API). Results are `{ source: "Bill of Lading Data knowledge base", data, source_ids, notes }`; `data` is the sales assistant's answer as is. The text content holds a one-line summary plus the result as JSON, for clients that pass only text to the model.
- What a server can see depends on its token, decided by the sales assistant: the staff token sees everything the drafting step sees, including rows marked `internal: true`; the public token sees customer-safe knowledge only. Neither ever returns sample rows, customer emails or histories, leads, or Gmail, Bigin or Calendly data.
- No credits, no credit guard, no Partner API call: the user's API key is never sent to the knowledge API, and the knowledge token never reaches the AI client, logs or errors. Calls count towards the connection's 60-a-minute limit; the knowledge API allows 120 a minute per token. Up to two retries on 429, 5xx and timeouts.

