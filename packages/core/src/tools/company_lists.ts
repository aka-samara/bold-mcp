import { compact, SOURCE } from "../schemas/common.js";
import {
  findCompetitorsInput, findCompetitorsOutput, listExportersOutput, listImportersOutput, rankedListInput, searchCompaniesInput, searchCompaniesOutput,
} from "../schemas/company_lists.js";
import { extractRows, pageInfo, toCountry, toCountryList, toNumber, toStr, toStrArray, toStrList, truncate, type PageInfo } from "../shaping/normalize.js";
import { tradeFilterBody } from "./shared.js";
import { defineTool, PAID_READ_ONLY } from "./types.js";

type Row = Record<string, unknown>;
const rowsOf = (data: unknown) => extractRows(data).map((r) => (r ?? {}) as Row);
const idOf = (o: Row) => toStr(o.id ?? o.company_id);
const hasId = <T extends { company_id: string | null }>(r: T): r is T & { company_id: string } => r.company_id !== null;

/**
 * `partners`: the live API gives import_countries and export_countries; the
 * trading partners are the exporting countries for an importer and the
 * importing countries for an exporter.
 */
function rankedBase(o: Row, partners: "import_countries" | "export_countries") {
  const products = truncate(toStrArray(o.products).join("; ") || null);
  return {
    rank: toNumber(o.rank),
    company_id: idOf(o),
    name: toStr(o.name),
    domain: toStr(o.domain),
    country: toCountry(o.country),
    total_shipments: toNumber(o.total_shipments),
    total_weight: toNumber(o.total_weight),
    countries: toCountryList(o.countries ?? o[partners]),
    ports: toStrList(o.ports, o.loading_ports, o.unloading_ports),
    products: products.text,
    products_truncated: products.truncated,
  };
}

const pageSummary = (what: string, n: number, page: PageInfo) =>
  `${n} ${what} on page ${page.page_no}${page.total !== null ? ` of ${page.total} total` : ""}${page.has_more ? "; more pages available (ask before fetching)" : ""}. Source: Bill of Lading Data.`;

export const listImporters = defineTool({
  name: "list_importers",
  title: "List importers",
  description: [
    "Costs 15 data credits per company returned.",
    "Ranked buyers (importers) of a product or HS code: rank, company_id, name, domain, country, import value, shipments, quantity, weight, number of suppliers, countries, ports and sample products.",
    "Call get_market_insights (free) first and keep page_size small. Returns importers only, so there is no type field. Give at least one of hs_codes, products or company_id.",
  ].join("\n"),
  inputSchema: rankedListInput,
  outputSchema: listImportersOutput,
  annotations: { ...PAID_READ_ONLY, title: "List importers" },
  endpoints: ["all-importers"],
  paid: true,
  async handler(args, rt) {
    const { type: _t, ...filter } = tradeFilterBody(args);
    void _t;
    const data = await rt.call("all-importers", compact({ ...filter, page_size: args.page_size, page_no: args.page_no }));
    const raw = rowsOf(data);
    const rows = raw
      .map((o) => ({ ...rankedBase(o, "export_countries"), total_import_value: toNumber(o.total_import_value), total_import_quantity: toNumber(o.total_import_quantity), total_suppliers: toNumber(o.total_suppliers) }))
      .filter(hasId);
    const page = pageInfo(data, rows.length, args.page_no, args.page_size);
    return { structured: { source: SOURCE, status: "ok" as const, pool: "data" as const, rows, ...page, next_page_cost_credits: 0 }, summary: pageSummary("importers", rows.length, page), billing: { units: raw.length } };
  },
});

export const listExporters = defineTool({
  name: "list_exporters",
  title: "List exporters",
  description: [
    "Costs 15 data credits per company returned.",
    "Ranked suppliers (exporters) of a product or HS code: rank, company_id, name, domain, country, export value, shipments, quantity, weight, number of buyers, countries, ports and sample products.",
    "Call get_market_insights (free) first and keep page_size small. Returns exporters only, so there is no type field. Give at least one of hs_codes, products or company_id.",
  ].join("\n"),
  inputSchema: rankedListInput,
  outputSchema: listExportersOutput,
  annotations: { ...PAID_READ_ONLY, title: "List exporters" },
  endpoints: ["all-exporters"],
  paid: true,
  async handler(args, rt) {
    const { type: _t, ...filter } = tradeFilterBody(args);
    void _t;
    const data = await rt.call("all-exporters", compact({ ...filter, page_size: args.page_size, page_no: args.page_no }));
    const raw = rowsOf(data);
    const rows = raw
      .map((o) => ({ ...rankedBase(o, "import_countries"), total_export_value: toNumber(o.total_export_value), total_export_quantity: toNumber(o.total_export_quantity), total_buyers: toNumber(o.total_buyers) }))
      .filter(hasId);
    const page = pageInfo(data, rows.length, args.page_no, args.page_size);
    return { structured: { source: SOURCE, status: "ok" as const, pool: "data" as const, rows, ...page, next_page_cost_credits: 0 }, summary: pageSummary("exporters", rows.length, page), billing: { units: raw.length } };
  },
});

export const searchCompanies = defineTool({
  name: "search_companies",
  title: "Search companies with trade totals",
  description: [
    "Costs 15 data credits per company returned.",
    "Use find_company_id (free) if you only need the id.",
    "Searches companies by name and adds trade totals (shipments, import value) to each match. Use only when the user wants totals for several name matches.",
  ].join("\n"),
  inputSchema: searchCompaniesInput,
  outputSchema: searchCompaniesOutput,
  annotations: { ...PAID_READ_ONLY, title: "Search companies with trade totals" },
  endpoints: ["company-search"],
  paid: true,
  async handler(args, rt) {
    const data = await rt.call(
      "company-search",
      compact({ type: args.type, company_name: args.company_name, countries: args.countries, date_range: args.date_range, page_size: args.page_size, page_no: args.page_no }),
    );
    const raw = rowsOf(data);
    const rows = raw
      .map((o) => ({ company_id: idOf(o), name: toStr(o.name), domain: toStr(o.domain), country: toCountry(o.country), total_shipments: toNumber(o.total_shipments), total_import_value: toNumber(o.total_import_value) }))
      .filter(hasId);
    const page = pageInfo(data, rows.length, args.page_no, args.page_size);
    return { structured: { source: SOURCE, status: "ok" as const, pool: "data" as const, rows, ...page, next_page_cost_credits: 0 }, summary: pageSummary("companies", rows.length, page), billing: { units: raw.length } };
  },
});

export const findCompetitors = defineTool({
  name: "find_competitors",
  title: "Find competitors",
  description: [
    "Costs 15 data credits per competitor returned.",
    "Similar market players for a company: company_id, name, domain, country and number of shipments.",
    "Needs company_id and type: call find_company_id (free) first. Keep page_size small.",
  ].join("\n"),
  inputSchema: findCompetitorsInput,
  outputSchema: findCompetitorsOutput,
  annotations: { ...PAID_READ_ONLY, title: "Find competitors" },
  endpoints: ["competitors"],
  paid: true,
  async handler(args, rt) {
    const data = await rt.call("competitors", { type: args.type, company_id: args.company_id, page_size: args.page_size, page_no: args.page_no });
    const raw = rowsOf(data);
    const rows = raw
      .map((o) => ({ company_id: idOf(o), name: toStr(o.name), domain: toStr(o.domain), country: toCountry(o.country), no_of_shipments: toNumber(o.no_of_shipments) }))
      .filter(hasId);
    const page = pageInfo(data, rows.length, args.page_no, args.page_size);
    return { structured: { source: SOURCE, status: "ok" as const, pool: "data" as const, rows, ...page, next_page_cost_credits: 0 }, summary: pageSummary("competitors", rows.length, page), billing: { units: raw.length } };
  },
});
