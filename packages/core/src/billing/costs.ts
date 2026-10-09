import { z } from "zod";
import type { CreditPool } from "../client/endpoints.js";

/**
 * The cost table: the only place tool prices live. Defaults match the brief;
 * `BOLD_COSTS_JSON` (a JSON object keyed by tool name) overrides any entry so
 * prices can change without a code change.
 */

const PoolSchema = z.enum(["data", "contact", "kyb"]);

export const ToolCostSchema = z.discriminatedUnion("unit", [
  z.object({ unit: z.literal("free") }),
  z.object({ unit: z.literal("per_record"), pool: PoolSchema, credits: z.number().nonnegative(), default_page_size: z.number().int().positive() }),
  z.object({ unit: z.literal("per_page"), pool: PoolSchema, credits: z.number().nonnegative() }),
  z.object({ unit: z.literal("per_request"), pool: PoolSchema, credits: z.number().nonnegative() }),
  z.object({ unit: z.literal("per_section"), pool: PoolSchema, credits: z.number().nonnegative() }),
  z.object({
    unit: z.literal("per_lookup"),
    pool: PoolSchema,
    lookups: z.record(z.string(), z.number().nonnegative()),
  }),
]);
export type ToolCost = z.infer<typeof ToolCostSchema>;

export const DEFAULT_COSTS = {
  get_filter_options: { unit: "free" },
  get_market_insights: { unit: "free" },
  search_products: { unit: "free" },
  find_company_id: { unit: "free" },
  check_logistics_company: { unit: "free" },
  get_credit_balance: { unit: "free" },
  get_credit_history: { unit: "free" },
  estimate_cost: { unit: "free" },
  // Free in Lite mode; Pro mode is priced by `find_company_contacts_pro`.
  find_company_contacts: { unit: "free" },
  find_company_contacts_pro: { unit: "per_page", pool: "contact", credits: 2 },
  search_shipments: { unit: "per_record", pool: "data", credits: 1, default_page_size: 10 },
  list_importers: { unit: "per_record", pool: "data", credits: 15, default_page_size: 10 },
  list_exporters: { unit: "per_record", pool: "data", credits: 15, default_page_size: 10 },
  search_companies: { unit: "per_record", pool: "data", credits: 15, default_page_size: 5 },
  find_competitors: { unit: "per_record", pool: "data", credits: 15, default_page_size: 5 },
  get_company_profile: { unit: "per_request", pool: "data", credits: 20 },
  search_kyb: { unit: "per_request", pool: "kyb", credits: 3 },
  reveal_contact_details: { unit: "per_lookup", pool: "contact", lookups: { professional_emails: 10, personal_emails: 10, phones: 15 } },
  get_kyb_report: { unit: "per_section", pool: "kyb", credits: 10 },
} as const satisfies Record<string, ToolCost>;

export type CostKey = keyof typeof DEFAULT_COSTS;
export type CostTable = Record<CostKey, ToolCost>;

export const COST_KEYS = Object.keys(DEFAULT_COSTS) as CostKey[];

export function loadCostTable(env: NodeJS.ProcessEnv = process.env): CostTable {
  const table: CostTable = { ...DEFAULT_COSTS };
  const raw = env.BOLD_COSTS_JSON?.trim();
  if (!raw) return table;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("BOLD_COSTS_JSON is not valid JSON");
  }
  const overrides = z.record(z.string(), ToolCostSchema).safeParse(parsed);
  if (!overrides.success) throw new Error(`BOLD_COSTS_JSON is invalid: ${overrides.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  for (const [tool, cost] of Object.entries(overrides.data)) {
    if (!(tool in DEFAULT_COSTS)) throw new Error(`BOLD_COSTS_JSON: unknown tool "${tool}"`);
    table[tool as CostKey] = cost;
  }
  return table;
}

export const POOL_LABEL: Record<CreditPool, string> = { data: "data", contact: "contact", kyb: "KYB" };
