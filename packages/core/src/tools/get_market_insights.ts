import { compact, SOURCE } from "../schemas/common.js";
import { getMarketInsightsInput, getMarketInsightsOutput } from "../schemas/get_market_insights.js";
import { extractRows, normalizeFlat } from "../shaping/normalize.js";
import { defineTool, FREE_READ_ONLY } from "./types.js";
import { tradeFilterBody } from "./shared.js";

export const getMarketInsights = defineTool({
  name: "get_market_insights",
  title: "Get market insights",
  description: [
    "Free (no credits).",
    "The default first call for market-size and \"who trades this\" questions: total trade value, shipments, quantity, weight, number of importers, suppliers, countries, ports and HS codes, plus the top 10 importer and exporter countries.",
    "Prefer this over paid lists. Give at least one of hs_codes, products or company_id; date_range is at most 12 months (default: last 12 months).",
  ].join("\n"),
  inputSchema: getMarketInsightsInput,
  outputSchema: getMarketInsightsOutput,
  annotations: { ...FREE_READ_ONLY, title: "Get market insights" },
  endpoints: ["insights"],
  async handler(args, rt) {
    const data = ((await rt.call("insights", compact(tradeFilterBody(args)))) ?? {}) as Record<string, unknown>;
    const summary = normalizeFlat(data.import_summary ?? data.summary, args.language);
    const top_importer_countries = extractRows(data.top_10_importer_countries).map((r) => normalizeFlat(r, args.language));
    const top_exporter_countries = extractRows(data.top_10_exporter_countries).map((r) => normalizeFlat(r, args.language));
    const n = (k: string) => (typeof summary[k] === "number" ? (summary[k] as number).toLocaleString("en-US") : "unknown");
    return {
      structured: { source: SOURCE, summary, top_importer_countries, top_exporter_countries },
      summary: `Market insights: ${n("total_shipments")} shipments, total value ${n("total_import_value")}, ${n("total_importers")} importers, ${n("total_suppliers")} suppliers. Source: Bill of Lading Data.`,
    };
  },
});
