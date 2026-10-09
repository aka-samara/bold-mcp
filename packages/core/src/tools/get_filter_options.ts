import { compact, SOURCE } from "../schemas/common.js";
import { getFilterOptionsInput, getFilterOptionsOutput } from "../schemas/get_filter_options.js";
import { nameList, optionList, range, unitRanges } from "../shaping/filters.js";
import { defineTool, FREE_READ_ONLY } from "./types.js";

export const getFilterOptions = defineTool({
  name: "get_filter_options",
  title: "Get filter options",
  description: [
    "Free (no credits).",
    "Turns a product, HS code or company into valid filter values before any paid call: HS codes, import/export countries, loading/unloading ports, and value, weight, quantity and shipment ranges.",
    "Pass the returned `value` (not `label`) into other tools.",
    "Set include_parties=true to also get importer and exporter names, transport types and bill of lading numbers.",
    "Give at least one of hs_codes, products or company_id.",
  ].join("\n"),
  inputSchema: getFilterOptionsInput,
  outputSchema: getFilterOptionsOutput,
  annotations: { ...FREE_READ_ONLY, title: "Get filter options" },
  endpoints: ["search-filters", "shipping-filters"],
  async handler(args, rt) {
    const path = args.include_parties ? "shipping-filters" : "search-filters";
    const body = compact({ type: args.type, hs_codes: args.hs_codes, products: args.products, company_id: args.company_id });
    const data = ((await rt.call(path, body)) ?? {}) as Record<string, unknown>;
    const lang = args.language;
    const structured = {
      source: SOURCE,
      hs_codes: optionList(data.hs_codes, lang),
      import_countries: optionList(data.import_countries, lang),
      export_countries: optionList(data.export_countries, lang),
      loading_ports: optionList(data.loading_ports, lang),
      unloading_ports: optionList(data.unloading_ports, lang),
      import_value: range(data.import_value),
      export_value: range(data.export_value),
      total_shipments: range(data.total_shipments),
      quantities: unitRanges(data.quantities),
      weights: unitRanges(data.weights),
      ...(args.include_parties
        ? {
            importer_names: nameList(data.importer_names),
            exporter_names: nameList(data.exporter_names),
            transport_types: nameList(data.transport_types),
            bill_of_lading_nbrs: nameList(data.bill_of_lading_nbrs),
          }
        : {}),
    };
    const s = structured;
    const summary =
      `Filter options: ${s.hs_codes.total} HS codes, ${s.import_countries.total} import countries, ${s.export_countries.total} export countries, ` +
      `${s.loading_ports.total} loading ports, ${s.unloading_ports.total} unloading ports` +
      (s.importer_names ? `, ${s.importer_names.total} importer names, ${s.exporter_names?.total ?? 0} exporter names` : "") +
      ". Source: Bill of Lading Data.";
    return { structured, summary };
  },
});
