import { estimateCost } from "../billing/estimator.js";
import { utcDay } from "../billing/daily-spend.js";
import { decide } from "../billing/guard.js";
import { POOL_LABEL } from "../billing/costs.js";
import { SOURCE } from "../schemas/common.js";
import { estimateCostInput, estimateCostOutput } from "../schemas/estimate_cost.js";
import { UNLOCK_TOOLS } from "./names.js";
import { defineTool, FREE_READ_ONLY } from "./types.js";

export const estimateCostTool = defineTool({
  name: "estimate_cost",
  title: "Estimate cost",
  description: [
    "Free (no credits).",
    "Before a paid call, shows the worst-case credits it can use, which pool pays (data, contact or KYB), the pool's current balance, and whether the call will ask the user to confirm.",
    "Credits are charged only for data actually returned.",
  ].join("\n"),
  inputSchema: estimateCostInput,
  outputSchema: estimateCostOutput,
  annotations: { ...FREE_READ_ONLY, title: "Estimate cost" },
  endpoints: ["credit-usage"],
  async handler(args, rt) {
    const est = estimateCost(rt.deps.costs, args.tool, args.arguments);
    if (!est) throw new Error(`No cost entry for ${args.tool}`);
    const settings = rt.caller.settings;
    const maxArg = typeof args.arguments.max_credits === "number" ? args.arguments.max_credits : undefined;
    const perCallLimit = Math.min(settings.perCallLimit, maxArg ?? Number.POSITIVE_INFINITY);
    let pool_remaining: number | null = null;
    let needs_confirmation = false;
    if (est.pool) {
      pool_remaining = (await rt.balances())[est.pool].remaining;
      const spentToday = await rt.deps.dailySpend.get(rt.caller.connectionId ?? rt.caller.fingerprint, utcDay());
      const decision = decide({ estimate: { ...est, pool: est.pool }, isUnlock: UNLOCK_TOOLS.includes(args.tool), settings, maxCreditsArg: maxArg, spentToday, remaining: null });
      needs_confirmation = decision.action !== "proceed";
    }
    const enough_credits = est.pool === null ? true : pool_remaining === null ? null : pool_remaining >= est.max_credits;
    const label = est.pool ? POOL_LABEL[est.pool] : null;
    return {
      structured: { source: SOURCE, tool: args.tool, pool: est.pool, max_credits: est.max_credits, basis: est.basis, pool_remaining, enough_credits, per_call_limit: perCallLimit, needs_confirmation },
      summary:
        est.pool === null
          ? `${args.tool} is free.`
          : `${args.tool} can use up to ${est.max_credits} ${label} credits (${est.basis}); ${pool_remaining ?? "unknown"} ${label} credits remain.` +
            (needs_confirmation ? " The user will be asked to confirm." : ""),
    };
  },
});
