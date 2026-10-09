import { z } from "zod";
import { CountryCode, DateRange, PageNo, Source, TradeType, pageOutputShape, pageSize } from "./common.js";

export const findCompanyIdInput = z.object({
  type: TradeType,
  company_name: z.string().trim().min(2).max(200).describe("Company name or part of it, e.g. a shipper_name or consignee_name from search_shipments"),
  countries: z.array(CountryCode).max(20).optional(),
  date_range: DateRange.optional(),
  page_size: pageSize(10, 50),
  page_no: PageNo,
});

export const CompanyRow = z.object({
  company_id: z.string().describe("Pass this as company_id to other tools"),
  name: z.string().nullable(),
  domain: z.string().nullable(),
  country: z.string().nullable(),
});

export const findCompanyIdOutput = z.object({ source: Source, rows: z.array(CompanyRow), ...pageOutputShape });
