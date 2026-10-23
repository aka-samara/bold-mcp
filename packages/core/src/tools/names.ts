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

/** The 12 optional knowledge tools (free; registered only when the knowledge API is configured). */
export const KNOWLEDGE_TOOL_NAMES = [
  "search_knowledge",
  "resolve_countries",
  "resolve_route",
  "get_coverage",
  "get_field_gaps",
  "get_schema",
  "get_volume",
  "get_packages",
  "price_quote",
  "get_terms",
  "get_api_reference",
  "get_samples",
] as const;
export type KnowledgeToolName = (typeof KNOWLEDGE_TOOL_NAMES)[number];
