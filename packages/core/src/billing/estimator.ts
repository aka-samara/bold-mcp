import type { CreditPool } from "../client/endpoints.js";
import { COST_KEYS, type CostKey, type CostTable, type ToolCost } from "./costs.js";

export interface Estimate {
  tool: string;
  pool: CreditPool | null;
  /** Worst case for this call. */
  max_credits: number;
  /** Plain-words breakdown, e.g. "10 records × 15 credits". */
  basis: string;
}

type Args = Record<string, unknown>;

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
}

function list(v: unknown): string[] {
  return Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string"))] : [];
}

export function costKeyFor(tool: string, args: Args): CostKey | null {
  if (tool === "find_company_contacts") return args.volume === "pro" ? "find_company_contacts_pro" : "find_company_contacts";
  return (COST_KEYS as string[]).includes(tool) ? (tool as CostKey) : null;
}

function fromCost(tool: string, cost: ToolCost, args: Args): Estimate {
  switch (cost.unit) {
    case "free":
      return { tool, pool: null, max_credits: 0, basis: "free" };
    case "per_record": {
      const size = num(args.page_size, cost.default_page_size);
      return { tool, pool: cost.pool, max_credits: size * cost.credits, basis: `${size} record${size === 1 ? "" : "s"} × ${cost.credits} credit${cost.credits === 1 ? "" : "s"}` };
    }
    case "per_page":
      return { tool, pool: cost.pool, max_credits: cost.credits, basis: `1 page × ${cost.credits} credits` };
    case "per_request":
      return { tool, pool: cost.pool, max_credits: cost.credits, basis: `1 request × ${cost.credits} credits` };
    case "per_section": {
      const sections = list(args.sections);
      const n = Math.max(sections.length, 1);
      return { tool, pool: cost.pool, max_credits: n * cost.credits, basis: `${n} section${n === 1 ? "" : "s"} × ${cost.credits} credits` };
    }
    case "per_lookup": {
      const types = list(args.lookup_type).filter((t) => t in cost.lookups);
      const total = types.reduce((sum, t) => sum + (cost.lookups[t] ?? 0), 0);
      return { tool, pool: cost.pool, max_credits: total, basis: types.length ? types.map((t) => `${t} ${cost.lookups[t]}`).join(" + ") + " (1 person)" : "no lookup types" };
    }
  }
}

/** Worst-case credits and pool for one tool call. Unknown tools return null. */
export function estimateCost(table: CostTable, tool: string, args: Args = {}): Estimate | null {
  const key = costKeyFor(tool, args);
  if (!key) return null;
  return fromCost(tool, table[key], args);
}

/** Worst-case credits for the page after this one (same arguments, page_no + 1). */
export function nextPageCost(table: CostTable, tool: string, args: Args): number {
  return estimateCost(table, tool, { ...args, page_no: num(args.page_no, 1) + 1 })?.max_credits ?? 0;
}
