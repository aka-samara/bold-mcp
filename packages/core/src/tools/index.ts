import { checkLogisticsCompany } from "./check_logistics_company.js";
import { estimateCostTool } from "./estimate_cost.js";
import { findCompanyContacts } from "./find_company_contacts.js";
import { findCompanyId } from "./find_company_id.js";
import { getCreditBalance } from "./get_credit_balance.js";
import { getCreditHistory } from "./get_credit_history.js";
import { getFilterOptions } from "./get_filter_options.js";
import { getMarketInsights } from "./get_market_insights.js";
import { searchProducts } from "./search_products.js";
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

export const ALL_TOOLS: readonly ToolDefinition[] = [...FREE_TOOLS];
