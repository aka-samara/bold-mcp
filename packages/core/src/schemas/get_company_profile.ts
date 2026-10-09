import { z } from "zod";
import { CompanyId, FlatRecord, TradeType, paidInputShape, paidOutput } from "./common.js";

export const getCompanyProfileInput = z.object({ type: TradeType, company_id: CompanyId, ...paidInputShape });

export const CompanyProfile = z.object({
  company_id: z.string(),
  name: z.string().nullable(),
  country: z.string().nullable(),
  domain: z.string().nullable(),
  tags: z.array(z.string()),
  contact_info: FlatRecord.describe("Company-level address, phone, email as listed"),
  social_links: FlatRecord,
  totals: FlatRecord.describe("Trade totals: value, shipments, quantity, weight, partners"),
  countries: z.array(z.string()),
  ports: z.array(z.string()),
  industry_classifications: z.object({ hs: z.array(z.string()), naics: z.array(z.string()), sitc: z.array(z.string()) }),
  is_logistics_company: z.boolean().nullable(),
});

export const getCompanyProfileOutput = paidOutput({ profile: CompanyProfile.nullable() });
