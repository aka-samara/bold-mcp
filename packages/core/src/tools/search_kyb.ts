import { compact, SOURCE } from "../schemas/common.js";
import { searchKybInput, searchKybOutput } from "../schemas/search_kyb.js";
import { extractRows, toStr } from "../shaping/normalize.js";
import { defineTool, PAID_READ_ONLY } from "./types.js";

export const searchKyb = defineTool({
  name: "search_kyb",
  title: "Search KYB registry",
  description: [
    "Costs 3 KYB credits per search.",
    "Finds a company's official registry record: kyb_id, registered name, registration number, VAT number, country, state and jurisdiction. The kyb_id feeds get_kyb_report.",
    "Call only when the user wants registry (KYB) information. Give company_id with type (from find_company_id, free) or company_name with country_code.",
  ].join("\n"),
  inputSchema: searchKybInput,
  outputSchema: searchKybOutput,
  annotations: { ...PAID_READ_ONLY, title: "Search KYB registry" },
  endpoints: ["kyb-search"],
  paid: true,
  async handler(args, rt) {
    const body = args.company_id
      ? { company_id: args.company_id, type: args.type }
      : compact({ company_name: args.company_name, country_code: args.country_code });
    const data = await rt.call("kyb-search", body);
    const raw = extractRows(data);
    const rows = raw
      .map((r) => {
        const o = (r ?? {}) as Record<string, unknown>;
        return {
          kyb_id: toStr(o.id ?? o.kyb_id),
          name: toStr(o.name),
          registration_number: toStr(o.registration_number),
          vat_number: toStr(o.vat_number),
          country_code: toStr(o.country_code),
          state: toStr(o.state),
          jurisdiction: toStr(o.jurisdiction),
        };
      })
      .filter((r): r is typeof r & { kyb_id: string } => r.kyb_id !== null);
    return {
      structured: { source: SOURCE, status: "ok" as const, pool: "kyb" as const, rows },
      summary: rows.length ? `${rows.length} registry record${rows.length === 1 ? "" : "s"} found. Source: Bill of Lading Data.` : "No registry record matched.",
      billing: { units: raw.length > 0 ? 1 : 0 },
    };
  },
});
