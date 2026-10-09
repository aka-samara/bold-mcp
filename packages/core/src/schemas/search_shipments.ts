import { z } from "zod";
import {
  CountryCode, DateRange, HsCode, Language, PageNo, ScalarValue, TRANSPORT_TYPES, TradeType, UnitRange, ValueRange,
  pageOutputShape, pageSize, paidInputShape, paidOutput,
} from "./common.js";

const names = (what: string) => z.array(z.string().trim().min(1).max(200)).min(1).max(20).optional().describe(what);

export const searchShipmentsInput = z
  .object({
    type: TradeType,
    hs_codes: z.array(HsCode).min(1).max(20).optional(),
    products: z.array(z.string().trim().min(2).max(100)).min(1).max(10).optional(),
    company_ids: z.array(z.string().trim().min(1).max(200)).min(1).max(20).optional().describe("company_id values from find_company_id (an array here)"),
    bill_of_lading_nbrs: names("Bill of lading numbers"),
    date_range: DateRange.optional(),
    import_countries: z.array(CountryCode).max(50).optional(),
    export_countries: z.array(CountryCode).max(50).optional(),
    import_value: ValueRange.optional(),
    weight: UnitRange.optional(),
    quantity: UnitRange.optional(),
    loading_ports: names("Loading port values from get_filter_options"),
    unloading_ports: names("Unloading port values from get_filter_options"),
    importer_names: names("Importer names from get_filter_options(include_parties)"),
    exporter_names: names("Exporter names from get_filter_options(include_parties)"),
    transport_types: z.array(z.enum(TRANSPORT_TYPES)).max(8).optional(),
    page_size: pageSize(10, 50),
    page_no: PageNo,
    language: Language,
    ...paidInputShape,
  })
  .superRefine((v, ctx) => {
    if (!v.hs_codes?.length && !v.products?.length && !v.company_ids?.length && !v.bill_of_lading_nbrs?.length)
      ctx.addIssue({ code: "custom", message: "Give at least one of hs_codes, products, company_ids or bill_of_lading_nbrs" });
  });

export const ShipmentRow = z
  .object({
    shipment_id: z.string().nullable().describe("Shipment record id, NOT a company_id"),
    date: z.string().nullable().describe("Shipment date, YYYY-MM-DD"),
    import_record_id: z.string().nullable().describe("Record id, NOT a company_id. Use consignee_name with find_company_id."),
    export_record_id: z.string().nullable().describe("Record id, NOT a company_id. Use shipper_name with find_company_id."),
    shipper_name: z.string().nullable(),
    consignee_name: z.string().nullable(),
    hs_code: z.string().nullable(),
    products: z.string().nullable().describe("Product text, truncated to 200 characters"),
    products_truncated: z.boolean(),
    bill_of_lading_nbr: z.string().nullable(),
  })
  .catchall(ScalarValue);

export const searchShipmentsOutput = paidOutput({ rows: z.array(ShipmentRow), ...pageOutputShape });
