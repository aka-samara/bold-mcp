import { z } from "zod";
import { CompanyId, HsCode, Language, LabelValue, Range, Source, TradeType, UnitRangeOut, requireSubject } from "./common.js";

export const getFilterOptionsInput = z
  .object({
    type: TradeType,
    hs_codes: z.array(HsCode).min(1).max(20).optional(),
    products: z.array(z.string().trim().min(2).max(100)).min(1).max(10).optional(),
    company_id: CompanyId.optional(),
    include_parties: z.boolean().default(false).describe("Also return importer/exporter names, transport types and B/L numbers"),
    language: Language,
  })
  .superRefine(requireSubject);

const OptionList = z.object({
  items: z.array(LabelValue),
  total: z.number().describe("How many the API returned"),
  truncated: z.boolean().describe("True when only the first items are shown"),
});
const NameList = z.object({ items: z.array(z.string()), total: z.number(), truncated: z.boolean() });

export const getFilterOptionsOutput = z.object({
  source: Source,
  hs_codes: OptionList,
  import_countries: OptionList,
  export_countries: OptionList,
  loading_ports: OptionList,
  unloading_ports: OptionList,
  import_value: Range.nullable(),
  export_value: Range.nullable(),
  total_shipments: Range.nullable(),
  quantities: z.array(UnitRangeOut),
  weights: z.array(UnitRangeOut),
  importer_names: NameList.optional(),
  exporter_names: NameList.optional(),
  transport_types: NameList.optional(),
  bill_of_lading_nbrs: NameList.optional(),
});
