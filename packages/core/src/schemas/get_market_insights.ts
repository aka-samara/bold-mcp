import { z } from "zod";
import { FlatRecord, Language, Source, requireSubject, tradeFilterShape } from "./common.js";

export const getMarketInsightsInput = z.object({ ...tradeFilterShape, language: Language }).superRefine(requireSubject);

export const getMarketInsightsOutput = z.object({
  source: Source,
  summary: FlatRecord.describe("Market totals: value, shipments, quantity, weight, importers, suppliers, countries, ports, HS codes"),
  top_importer_countries: z.array(FlatRecord),
  top_exporter_countries: z.array(FlatRecord),
});
