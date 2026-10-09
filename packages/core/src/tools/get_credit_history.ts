import { compact, SOURCE } from "../schemas/common.js";
import { getCreditHistoryInput, getCreditHistoryOutput } from "../schemas/get_credit_history.js";
import { extractRows, pageInfo, toIsoDateTime, toNumber, toStr } from "../shaping/normalize.js";
import { defineTool, FREE_READ_ONLY } from "./types.js";

export const getCreditHistory = defineTool({
  name: "get_credit_history",
  title: "Get credit history",
  description: [
    "Free (no credits).",
    "Lists recent credit charges on the account, newest first: credit type, action, credits used and time. Use it to show what was spent, including by AI tools. Filter by credit_type or action.",
  ].join("\n"),
  inputSchema: getCreditHistoryInput,
  outputSchema: getCreditHistoryOutput,
  annotations: { ...FREE_READ_ONLY, title: "Get credit history" },
  endpoints: ["credit-usage-logs"],
  async handler(args, rt) {
    const data = await rt.call("credit-usage-logs", compact({ credit_type: args.credit_type, action: args.action, page_size: args.page_size, page_no: args.page_no }));
    const rows = extractRows(data).map((r) => {
      const o = (r ?? {}) as Record<string, unknown>;
      return { id: toStr(o.id), credit_type: toStr(o.credit_type), action: toStr(o.action), credits_used: toNumber(o.credits_used), created_at: toIsoDateTime(o.created_at) };
    });
    const page = pageInfo(data, rows.length, args.page_no, args.page_size);
    const spent = rows.reduce((s, r) => s + (r.credits_used ?? 0), 0);
    return {
      structured: { source: SOURCE, rows, ...page, next_page_cost_credits: 0 },
      summary: `${rows.length} charge${rows.length === 1 ? "" : "s"} on this page, ${spent.toLocaleString("en-US")} credits in total.`,
    };
  },
});
