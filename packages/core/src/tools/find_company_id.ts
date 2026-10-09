import { compact, SOURCE } from "../schemas/common.js";
import { findCompanyIdInput, findCompanyIdOutput } from "../schemas/find_company_id.js";
import { extractRows, pageInfo, toCountry, toStr } from "../shaping/normalize.js";
import { defineTool, FREE_READ_ONLY } from "./types.js";

export const findCompanyId = defineTool({
  name: "find_company_id",
  title: "Find company id",
  description: [
    "Free (no credits; limited to 30 calls a minute, 450 an hour, 1,500 a day).",
    "The default way to turn a company name into a company_id. Call this before any tool that needs a company_id.",
    "Returns company_id, name, domain and country. To find the company behind a shipment, pass its shipper_name or consignee_name here; shipment import_id/export_id are record ids, not company ids.",
  ].join("\n"),
  inputSchema: findCompanyIdInput,
  outputSchema: findCompanyIdOutput,
  annotations: { ...FREE_READ_ONLY, title: "Find company id" },
  endpoints: ["company-search-free"],
  async handler(args, rt) {
    const data = await rt.call(
      "company-search-free",
      compact({ type: args.type, company_name: args.company_name, countries: args.countries, date_range: args.date_range, page_size: args.page_size, page_no: args.page_no }),
    );
    const rows = extractRows(data)
      .map((r) => {
        const o = (r ?? {}) as Record<string, unknown>;
        return { company_id: toStr(o.id ?? o.company_id), name: toStr(o.name), domain: toStr(o.domain), country: toCountry(o.country) };
      })
      .filter((r): r is typeof r & { company_id: string } => r.company_id !== null);
    const page = pageInfo(data, rows.length, args.page_no, args.page_size);
    return {
      structured: { source: SOURCE, rows, ...page, next_page_cost_credits: 0 },
      summary: rows.length ? `${rows.length} matching compan${rows.length === 1 ? "y" : "ies"} with company_id values. Source: Bill of Lading Data.` : "No company matched that name. Try a shorter or different spelling.",
    };
  },
});
