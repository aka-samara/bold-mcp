import { z } from "zod";
import { CONTACT_ROLES, CompanyId, PageNo, TradeType, pageOutputShape, pageSize, paidInputShape, paidOutput } from "./common.js";

export const findCompanyContactsInput = z
  .object({
    company_id: CompanyId.optional(),
    type: TradeType.optional().describe("Required with company_id"),
    company_name: z.string().trim().min(2).max(200).optional().describe("Use instead of company_id"),
    roles: z.array(z.enum(CONTACT_ROLES)).max(7).optional(),
    page_size: pageSize(10, 50),
    page_no: PageNo,
    volume: z.enum(["lite", "pro"]).default("lite").describe('"pro" costs 2 contact credits per page; use only when the free limit is reached or the user asks for many companies'),
    ...paidInputShape,
  })
  .superRefine((v, ctx) => {
    if (v.company_id && !v.type) ctx.addIssue({ code: "custom", path: ["type"], message: "type is required with company_id" });
    if (!v.company_id && !v.company_name) ctx.addIssue({ code: "custom", message: "Give company_id (with type) or company_name" });
  });

export const ContactRow = z.object({
  contact_id: z.string().describe("Pass to reveal_contact_details to unlock emails or phones"),
  name: z.string().nullable(),
  position: z.string().nullable(),
  company: z.string().nullable(),
  country_code: z.string().nullable(),
  linkedin_url: z.string().nullable(),
  available: z.record(z.string(), z.union([z.number(), z.boolean(), z.string(), z.null()])).describe("Which details exist (counts), without revealing them"),
});

export const findCompanyContactsOutput = paidOutput({ mode: z.enum(["lite", "pro"]), rows: z.array(ContactRow), ...pageOutputShape });
