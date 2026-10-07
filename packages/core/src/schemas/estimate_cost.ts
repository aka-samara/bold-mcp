import { z } from "zod";
import { Source } from "./common.js";
import { TOOL_NAMES } from "../tools/names.js";

export const estimateCostInput = z.object({
  tool: z.enum(TOOL_NAMES).describe("The tool you plan to call"),
  arguments: z.record(z.string(), z.unknown()).default({}).describe("The arguments you plan to pass (page_size, sections, lookup_type, volume matter)"),
});

export const estimateCostOutput = z.object({
  source: Source,
  tool: z.string(),
  pool: z.enum(["data", "contact", "kyb"]).nullable().describe("Credit pool charged, or null when free"),
  max_credits: z.number().describe("Worst case for this call; charged only for data actually returned"),
  basis: z.string(),
  pool_remaining: z.number().nullable().describe("Current remaining balance in that pool"),
  enough_credits: z.boolean().nullable(),
  per_call_limit: z.number(),
  needs_confirmation: z.boolean().describe("True when the call will ask the user before spending"),
});
