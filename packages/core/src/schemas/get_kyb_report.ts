import { z } from "zod";
import { FlatRecord, paidInputShape, paidOutput } from "./common.js";

export const KYB_SECTIONS = ["details", "financials", "shareholders", "officers"] as const;

export const getKybReportInput = z.object({
  kyb_id: z.string().trim().min(1).max(200).describe("kyb_id from search_kyb"),
  sections: z
    .array(z.enum(KYB_SECTIONS))
    .min(1)
    .max(4)
    .refine((a) => new Set(a).size === a.length, "sections must be unique")
    .describe("Sections to unlock, 10 KYB credits each: details, financials, shareholders, officers"),
  page_size: z.number().int().min(1).max(100).default(20).describe("Rows for shareholders and officers (max 100)"),
  page_no: z.number().int().min(1).max(1000).default(1).describe("Page for shareholders and officers"),
  ...paidInputShape,
});

const PagedRows = z.object({
  rows: z.array(FlatRecord),
  total: z.number().nullable(),
  page_no: z.number(),
  page_size: z.number(),
  has_more: z.boolean(),
});

export const FinancialTable = z.object({
  group: z.string().describe("e.g. Income statement"),
  years: z.array(z.string()).describe("Column order"),
  rows: z.array(FlatRecord).describe("One row per line item: item plus a value per year"),
});

export const getKybReportOutput = paidOutput({
  kyb_id: z.string(),
  details: FlatRecord.nullable().optional(),
  financials: z.array(FinancialTable).nullable().optional(),
  shareholders: PagedRows.nullable().optional(),
  officers: PagedRows.nullable().optional(),
  returned_sections: z.array(z.enum(KYB_SECTIONS)).describe("Sections that returned data and were charged"),
  section_errors: z.record(z.string(), z.string()).optional().describe("Sections that failed (not charged), with the reason"),
});
