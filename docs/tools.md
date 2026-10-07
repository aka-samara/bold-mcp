# Tools

18 tools over the 22 global endpoint paths. This file is updated whenever a tool changes. Status: **planned** until the tool ships in its milestone.

| Tool | Endpoint(s) | Cost | Pool | Milestone | Status |
| --- | --- | --- | --- | --- | --- |
| `get_filter_options` | search-filters; shipping-filters (`include_parties=true`) | Free | — | M1 | shipped |
| `get_market_insights` | insights | Free | — | M1 | shipped |
| `search_products` | products | Free | — | M1 | shipped |
| `find_company_id` | company-search-free | Free | — | M1 | shipped |
| `check_logistics_company` | check-logistic-company | Free | — | M1 | shipped |
| `find_company_contacts` | company-contacts; advanced-company-contacts (`volume="pro"`) | Free; Pro 2 per page | Contact (Pro) | M1 (Pro mode in M2) | Lite shipped |
| `get_credit_balance` | credit-usage | Free | — | M1 | shipped |
| `get_credit_history` | credit-usage-logs | Free | — | M1 | shipped |
| `estimate_cost` | local | Free | — | M1 | shipped |
| `search_shipments` | shipping-records | 1 per record | Data | M2 | planned |
| `list_importers` | all-importers | 15 per record | Data | M2 | planned |
| `list_exporters` | all-exporters | 15 per record | Data | M2 | planned |
| `search_companies` | company-search | 15 per record | Data | M2 | planned |
| `find_competitors` | competitors | 15 per record | Data | M2 | planned |
| `get_company_profile` | company-details | 20 | Data | M2 | planned |
| `search_kyb` | kyb-search | 3 per search | KYB | M2 | planned |
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
