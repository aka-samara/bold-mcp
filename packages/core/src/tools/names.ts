/** All 18 tool names. Stable once a directory approves them. */
export const TOOL_NAMES = [
  "get_filter_options",
  "get_market_insights",
  "search_products",
  "find_company_id",
  "check_logistics_company",
  "find_company_contacts",
  "get_credit_balance",
  "get_credit_history",
  "estimate_cost",
  "search_shipments",
  "list_importers",
  "list_exporters",
  "search_companies",
  "find_competitors",
  "get_company_profile",
  "search_kyb",
  "reveal_contact_details",
  "get_kyb_report",
] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export const UNLOCK_TOOLS: readonly ToolName[] = ["reveal_contact_details", "get_kyb_report"];
