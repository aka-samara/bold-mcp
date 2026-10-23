/** One valid call per free tool, against the fixtures. */
export const SAMPLE_ARGS: Record<string, Record<string, unknown>> = {
  get_filter_options: { type: "imp", hs_codes: ["940360"] },
  get_market_insights: { type: "imp", hs_codes: ["940360"] },
  search_products: { type: "imp", hs_codes: ["940360"], page_size: 2 },
  find_company_id: { type: "imp", company_name: "acme", page_size: 2 },
  check_logistics_company: { type: "imp", company_id: "cmp_synthetic_001" },
  find_company_contacts: { company_id: "cmp_synthetic_001", type: "imp", page_size: 2 },
  get_credit_balance: {},
  get_credit_history: { page_size: 2 },
  estimate_cost: { tool: "list_importers", arguments: { page_size: 2 } },
};

/** One within-limits call per paid tool (page_size 1–2). */
export const PAID_SAMPLE_ARGS: Record<string, Record<string, unknown>> = {
  search_shipments: { type: "imp", hs_codes: ["940360"], page_size: 2 },
  list_importers: { hs_codes: ["940360"], page_size: 2 },
  list_exporters: { hs_codes: ["940360"], page_size: 2 },
  search_companies: { type: "imp", company_name: "acme", page_size: 2 },
  find_competitors: { type: "imp", company_id: "cmp_synthetic_001", page_size: 2 },
  get_company_profile: { type: "imp", company_id: "cmp_synthetic_001" },
  search_kyb: { company_name: "Acme Home Furnishings", country_code: "US" },
};

/** One call per unlock tool (always needs confirmation). */
export const UNLOCK_SAMPLE_ARGS: Record<string, Record<string, unknown>> = {
  reveal_contact_details: { contact_id: "ct_synthetic_001", lookup_type: ["professional_emails"] },
  get_kyb_report: { kyb_id: "kyb_synthetic_001", sections: ["details", "financials", "shareholders", "officers"], page_size: 2 },
};

/** One valid call per knowledge tool. */
export const KNOWLEDGE_SAMPLE_ARGS: Record<string, Record<string, unknown>> = {
  search_knowledge: { query: "how often is the data updated", limit: 3 },
  resolve_countries: { places: ["GCC"] },
  resolve_route: { origins: ["Vietnam"], destinations: ["US"] },
  get_coverage: { countries: ["VN"], direction: "export" },
  get_field_gaps: { countries: ["VN"], direction: "export" },
  get_schema: { country: "Vietnam", direction: "export" },
  get_volume: { countries: ["VN"], direction: "export", years: [2025] },
  get_packages: { channels: ["api"] },
  price_quote: { format: "api", global_records: 100 },
  get_terms: { query: "refunds", agreement: "licence" },
  get_api_reference: {},
  get_samples: { countries: ["VN"] },
};
