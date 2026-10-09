import { z } from "zod";
import { CompanyId, CountryCode, TradeType, paidInputShape, paidOutput } from "./common.js";

export const searchKybInput = z
  .object({
    company_id: CompanyId.optional(),
    type: TradeType.optional().describe("Required with company_id"),
    company_name: z.string().trim().min(2).max(200).optional().describe("Use with country_code instead of company_id"),
    country_code: CountryCode.optional(),
    ...paidInputShape,
  })
  .superRefine((v, ctx) => {
    if (v.company_id && !v.type) ctx.addIssue({ code: "custom", path: ["type"], message: "type is required with company_id" });
    if (!v.company_id && !(v.company_name && v.country_code)) ctx.addIssue({ code: "custom", message: "Give company_id with type, or company_name with country_code" });
  });

export const KybRecord = z.object({
  kyb_id: z.string().describe("Pass to get_kyb_report"),
  name: z.string().nullable(),
  registration_number: z.string().nullable(),
  vat_number: z.string().nullable(),
  country_code: z.string().nullable(),
  state: z.string().nullable(),
  jurisdiction: z.string().nullable(),
});

export const searchKybOutput = paidOutput({ rows: z.array(KybRecord) });
