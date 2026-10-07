import { compact, SOURCE } from "../schemas/common.js";
import { searchProductsInput, searchProductsOutput } from "../schemas/search_products.js";
import { extractRows, pageInfo, toNumber, toStr, truncate } from "../shaping/normalize.js";
import { defineTool, FREE_READ_ONLY } from "./types.js";
import { tradeFilterBody } from "./shared.js";

export const searchProducts = defineTool({
  name: "search_products",
  title: "Search products",
  description: [
    "Free (no credits).",
    "Maps product words to HS codes, or shows what a company trades: product description, HS code, shipments, import value and quantity per product.",
    "Use the hs_code values with other tools. Give at least one of hs_codes, products or company_id.",
  ].join("\n"),
  inputSchema: searchProductsInput,
  outputSchema: searchProductsOutput,
  annotations: { ...FREE_READ_ONLY, title: "Search products" },
  endpoints: ["products"],
  async handler(args, rt) {
    const data = await rt.call("products", compact({ ...tradeFilterBody(args), page_size: args.page_size, page_no: args.page_no }));
    const raw = extractRows(data);
    const rows = raw.map((r) => {
      const o = (r ?? {}) as Record<string, unknown>;
      const name = truncate(toStr(o.name));
      return {
        name: name.text,
        products_truncated: name.truncated,
        hs_code: toStr(o.hs_code),
        total_shipments: toNumber(o.total_shipments),
        total_import_value: toNumber(o.total_import_value),
        total_import_quantity: toNumber(o.total_import_quantity),
      };
    });
    const page = pageInfo(data, rows.length, args.page_no, args.page_size);
    return {
      structured: { source: SOURCE, rows, ...page, next_page_cost_credits: 0 },
      summary: `${rows.length} products on page ${page.page_no}${page.total !== null ? ` of ${page.total} total` : ""}${page.has_more ? "; more pages available" : ""}. Source: Bill of Lading Data.`,
    };
  },
});
