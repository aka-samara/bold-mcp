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
