import { checkLogisticsCompany } from "./check_logistics_company.js";
import { estimateCostTool } from "./estimate_cost.js";
import { findCompanyContacts } from "./find_company_contacts.js";
import { findCompanyId } from "./find_company_id.js";
import { getCreditBalance } from "./get_credit_balance.js";
import { getCreditHistory } from "./get_credit_history.js";
import { getFilterOptions } from "./get_filter_options.js";
import { getMarketInsights } from "./get_market_insights.js";
import { searchProducts } from "./search_products.js";
import { findCompetitors, listExporters, listImporters, searchCompanies } from "./company_lists.js";
import { getCompanyProfile } from "./get_company_profile.js";
import { searchKyb } from "./search_kyb.js";
import { searchShipments } from "./search_shipments.js";
import { getKybReport } from "./get_kyb_report.js";
import { revealContactDetails } from "./reveal_contact_details.js";
import type { ToolDefinition } from "./types.js";

/** Free tools (M1). */
export const FREE_TOOLS: readonly ToolDefinition[] = [
  getFilterOptions,
  getMarketInsights,
  searchProducts,
  findCompanyId,
  checkLogisticsCompany,
  findCompanyContacts,
  getCreditBalance,
  getCreditHistory,
  estimateCostTool,
] as unknown as readonly ToolDefinition[];

/** Paid tools (M2). */
export const PAID_TOOLS: readonly ToolDefinition[] = [
  searchShipments,
  listImporters,
  listExporters,
  searchCompanies,
  findCompetitors,
  getCompanyProfile,
  searchKyb,
] as unknown as readonly ToolDefinition[];

/** Unlock tools (M4): always need the user's confirmation. */
export const UNLOCK_TOOL_DEFS: readonly ToolDefinition[] = [revealContactDetails, getKybReport] as unknown as readonly ToolDefinition[];

export const ALL_TOOLS: readonly ToolDefinition[] = [...FREE_TOOLS, ...PAID_TOOLS, ...UNLOCK_TOOL_DEFS];
