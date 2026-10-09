import { compact, SOURCE } from "../schemas/common.js";
import { searchShipmentsInput, searchShipmentsOutput } from "../schemas/search_shipments.js";
import { extractRows, normalizeFlat, pageInfo, toIsoDate, toStr, truncate } from "../shaping/normalize.js";
import { defineTool, PAID_READ_ONLY } from "./types.js";

/** Fields renamed or reshaped below; everything else passes through normalised. */
const RESHAPED = new Set(["bydate", "import_id", "export_id", "products"]);

export const searchShipments = defineTool({
  name: "search_shipments",
  title: "Search shipments",
  description: [
    "Costs 1 data credit per shipment record returned.",
    "Shipment-level bill of lading detail: date, HS code, countries, value, quantity, weight, shipper, consignee, products, ports and B/L number. Also looks up specific B/L numbers.",
    "Use get_market_insights and get_filter_options (free) first. Give at least one of hs_codes, products, company_ids or bill_of_lading_nbrs.",
    "import_record_id/export_record_id are record ids, not company ids: pass shipper_name or consignee_name to find_company_id instead.",
  ].join("\n"),
  inputSchema: searchShipmentsInput,
  outputSchema: searchShipmentsOutput,
  annotations: { ...PAID_READ_ONLY, title: "Search shipments" },
  endpoints: ["shipping-records"],
  paid: true,
  async handler(args, rt) {
    const body = compact({
      type: args.type,
      hs_codes: args.hs_codes,
      products: args.products,
      company_ids: args.company_ids,
      bill_of_lading_nbrs: args.bill_of_lading_nbrs,
      date_range: args.date_range,
      import_countries: args.import_countries,
      export_countries: args.export_countries,
      import_value: args.import_value,
      weight: args.weight,
      quantity: args.quantity,
      loading_ports: args.loading_ports,
      unloading_ports: args.unloading_ports,
      importer_names: args.importer_names,
      exporter_names: args.exporter_names,
      transport_types: args.transport_types,
      page_size: args.page_size,
      page_no: args.page_no,
    });
    const data = await rt.call("shipping-records", body);
    const rows = extractRows(data).map((r) => {
      const o = (r ?? {}) as Record<string, unknown>;
      // Other fields (countries, value, weight, ports, brands, …) pass through normalised.
      const rest = Object.fromEntries(Object.entries(normalizeFlat(o, args.language)).filter(([k]) => !RESHAPED.has(k)));
      const text = truncate(toStr(o.products));
      return {
        ...rest,
        date: toIsoDate(o.bydate ?? o.date),
        import_record_id: toStr(o.import_id),
        export_record_id: toStr(o.export_id),
        shipper_name: toStr(o.shipper_name),
        consignee_name: toStr(o.consignee_name),
        hs_code: toStr(o.hs_code),
        products: text.text,
        products_truncated: text.truncated,
        bill_of_lading_nbr: toStr(o.bill_of_lading_nbr),
      };
    });
    const page = pageInfo(data, rows.length, args.page_no, args.page_size);
    return {
      structured: { source: SOURCE, status: "ok" as const, pool: "data" as const, rows, ...page, next_page_cost_credits: 0 },
      summary: `${rows.length} shipment record${rows.length === 1 ? "" : "s"} on page ${page.page_no}${page.total !== null ? ` of ${page.total} total` : ""}. Source: Bill of Lading Data.`,
      billing: { units: rows.length },
    };
  },
});
