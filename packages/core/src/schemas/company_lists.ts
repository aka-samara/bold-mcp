import { z } from "zod";
import { CompanyId, CountryCode, DateRange, PageNo, TradeType, pageOutputShape, pageSize, paidInputShape, paidOutput, requireSubject, tradeFilterShape } from "./common.js";

const { type: _type, ...filterWithoutType } = tradeFilterShape;
void _type;

/** All Importers / All Exporters: TradeFilter without `type` (team confirmed). */
export const rankedListInput = z
  .object({ ...filterWithoutType, page_size: pageSize(10, 50), page_no: PageNo, ...paidInputShape })
  .superRefine(requireSubject);

const base = {
  rank: z.number().nullable(),
  company_id: z.string().describe("Pass as company_id to other tools"),
  name: z.string().nullable(),
  domain: z.string().nullable(),
  country: z.string().nullable(),
  total_shipments: z.number().nullable(),
  total_weight: z.number().nullable(),
  countries: z.array(z.string()),
  ports: z.array(z.string()),
  products: z.string().nullable().describe("Sample products, truncated to 200 characters"),
  products_truncated: z.boolean(),
};

export const ImporterRow = z.object({ ...base, total_import_value: z.number().nullable(), total_import_quantity: z.number().nullable(), total_suppliers: z.number().nullable() });
export const ExporterRow = z.object({ ...base, total_export_value: z.number().nullable(), total_export_quantity: z.number().nullable(), total_buyers: z.number().nullable() });

export const listImportersOutput = paidOutput({ rows: z.array(ImporterRow), ...pageOutputShape });
export const listExportersOutput = paidOutput({ rows: z.array(ExporterRow), ...pageOutputShape });

export const searchCompaniesInput = z.object({
  type: TradeType,
  company_name: z.string().trim().min(2).max(200),
  countries: z.array(CountryCode).max(20).optional(),
  date_range: DateRange.optional(),
  page_size: pageSize(5, 50),
  page_no: PageNo,
  ...paidInputShape,
});
export const SearchCompanyRow = z.object({
  company_id: z.string(),
  name: z.string().nullable(),
  domain: z.string().nullable(),
  country: z.string().nullable(),
  total_shipments: z.number().nullable(),
  total_import_value: z.number().nullable(),
});
export const searchCompaniesOutput = paidOutput({ rows: z.array(SearchCompanyRow), ...pageOutputShape });

export const findCompetitorsInput = z.object({ type: TradeType, company_id: CompanyId, page_size: pageSize(5, 50), page_no: PageNo, ...paidInputShape });
export const CompetitorRow = z.object({
  company_id: z.string(),
  name: z.string().nullable(),
  domain: z.string().nullable(),
  country: z.string().nullable(),
  no_of_shipments: z.number().nullable(),
});
export const findCompetitorsOutput = paidOutput({ rows: z.array(CompetitorRow), ...pageOutputShape });
