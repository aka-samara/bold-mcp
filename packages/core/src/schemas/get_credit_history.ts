import { z } from "zod";
import { PageNo, Source, pageOutputShape, pageSize } from "./common.js";

export const getCreditHistoryInput = z.object({
  credit_type: z.string().trim().min(1).max(50).optional().describe('Filter by pool as the API names it, e.g. "data_credits"'),
  action: z.string().trim().min(1).max(100).optional().describe("Filter by action (endpoint) name"),
  page_size: pageSize(20, 250),
  page_no: PageNo,
});

export const CreditLogRow = z.object({
  id: z.string().nullable(),
  credit_type: z.string().nullable(),
  action: z.string().nullable(),
  credits_used: z.number().nullable(),
  created_at: z.string().nullable(),
});

export const getCreditHistoryOutput = z.object({ source: Source, rows: z.array(CreditLogRow), ...pageOutputShape });
