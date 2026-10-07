import { z } from "zod";
import { CompanyId, Source, TradeType } from "./common.js";

export const checkLogisticsCompanyInput = z.object({ type: TradeType, company_id: CompanyId });
export const checkLogisticsCompanyOutput = z.object({
  source: Source,
  company_id: z.string(),
  is_logistics_company: z.boolean().nullable().describe("True for freight forwarders and other logistics companies"),
});
