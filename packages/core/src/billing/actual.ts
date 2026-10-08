import type { ToolCost } from "./costs.js";

/** What a call actually returned, as reported by the tool handler. */
export interface BillingOutcome {
  /** Records (per_record), pages (per_page), requests (per_request) or sections (per_section) returned. */
  units?: number;
  /** Lookup types returned (per_lookup). */
  lookups?: string[];
}

/** Credits the Partner API is expected to have charged (brief: "credits_used … labelled estimated"). */
export function creditsUsed(cost: ToolCost, outcome: BillingOutcome | undefined): number {
  if (cost.unit === "free" || !outcome) return 0;
  if (cost.unit === "per_lookup") return (outcome.lookups ?? []).reduce((s, t) => s + (cost.lookups[t] ?? 0), 0);
  return Math.max(0, outcome.units ?? 0) * cost.credits;
}
