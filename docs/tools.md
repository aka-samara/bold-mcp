# Tools

18 tools over the 22 global endpoint paths. This file is updated whenever a tool changes. Status: **planned** until the tool ships in its milestone.

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
| `reveal_contact_details` | contact-look-up | 10 / 10 / 15 per person | Contact | M4 | planned |
| `get_kyb_report` | advanced-kyb-search, financial-kyb, shareholders-kyb, officers-kyb | 10 per section | KYB | M4 | planned |

## Shared behaviour

- Every result has `source: "Bill of Lading Data"`, typed `structuredContent` matching the tool's `outputSchema`, and a one-line text summary that never quotes API data.
- Paged results carry `total`, `page_no`, `page_size`, `has_more` and `next_page_cost_credits`.
- Chinese labels (`*_cn`) are dropped unless `language: "zh"` (filter options, insights).
- Product text is cut to 200 characters with `products_truncated: true`.
- Filter option lists show at most 100 items each, with `total` and `truncated`.
- `find_company_id` rows use `company_id` (the API's `id`) so it chains into other tools.
- `find_company_contacts` rows use `contact_id`, never include `profile_pic`, and show `available` (which details exist) instead of the details.
- Local limits: 60 tool calls a minute and 5 at once per connection; Company Search Free 30/min, 450/hr, 1,500/day and Contacts Lite 10/min, 150/hr, 25,000/month per key, with a message offering the paid alternative.

## Paid tools and the credit guard (M2)

- Paid tools take optional `max_credits` and `confirmation_token`, and every result carries `status` (`ok`, `confirmation_required`, `cancelled`), `pool`, `credits_used` (estimated from what was returned), `credits_used_is_estimate: true` and `credits_remaining` (pool balance refreshed after a charge). Per-record tools also give `next_page_cost_credits`.
- Before a paid call the server computes the worst case from `src/billing/costs.ts`, reads the pool balance from Credit Usage (cached 60 s per key) and:
  - refuses without calling the API if the worst case is more than the pool has left ("Not enough data credits — you have 20 left …");
  - asks the user when the worst case is above the per-call limit (default 150, or a lower `max_credits`), or would pass the connection's daily limit (default 2,000, all pools), and always for unlock tools;
  - asks through MCP elicitation when the client supports it, otherwise returns `status: "confirmation_required"` with a signed, single-use, 10-minute `confirmation_token` bound to the connection, tool and exact arguments.
- `find_company_contacts` with `volume: "pro"` calls Contacts Pro and charges 2 contact credits per non-empty page. Its annotation is not idempotent because of Pro mode.
- Header-mode spending settings: `X-Bold-Max-Credits`, `X-Bold-Daily-Credits`, `X-Bold-Allow-Contacts`, `X-Bold-Allow-KYB`. Stdio: `BOLD_MAX_CREDITS`, `BOLD_DAILY_CREDITS`, `BOLD_ALLOW_CONTACTS`, `BOLD_ALLOW_KYB`.
- `search_shipments` rows rename `import_id`/`export_id` to `import_record_id`/`export_record_id` and `bydate` to `date` (ISO), so record ids are never mistaken for company ids.
