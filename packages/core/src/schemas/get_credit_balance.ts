import { z } from "zod";
import { FlatRecord, Source } from "./common.js";

export const getCreditBalanceInput = z.object({});

export const PoolBalanceOut = z.object({ total: z.number().nullable(), used: z.number().nullable(), remaining: z.number().nullable() });
export const getCreditBalanceOutput = z.object({
  source: Source,
  data_credits: PoolBalanceOut,
  contact_credits: PoolBalanceOut,
  kyb_credits: PoolBalanceOut,
  usage: FlatRecord.describe("Usage counts per action, as reported by the API"),
});
