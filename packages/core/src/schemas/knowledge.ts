import { z } from "zod";

/**
 * Inputs for the knowledge tools. They mirror the sales assistant's KB_TOOLS
 * schemas (bold-sales-assistant `packages/kb/src/tools.ts`), which validate
 * again on their side; `npm run check:knowledge` compares the two.
 */

export const KNOWLEDGE_SOURCE = "Bill of Lading Data knowledge base" as const;

/** search_knowledge collections, plus "documents" for uploaded guides. */
export const KNOWLEDGE_COLLECTIONS = [
  "faq",
  "objection",
  "proof_point",
  "competitor",
  "snippet",
  "market_note",
  "company_info",
  "product",
  "coverage",
  "pricing",
  "api",
  "policy",
  "process",
  "data_quality",
  "qualification",
  "escalation",
  "do_not_promise",
  "use_case",
  "documents",
] as const;

const places = z
  .array(z.string().min(1).max(80))
  .min(1)
  .max(60)
  .describe('Country names, ISO codes or regions, e.g. ["Vietnam", "US", "GCC"]');
const direction = z.enum(["import", "export"]).describe("Imports or exports of the named countries");
const qty = z.number().int().min(0).max(1_000_000_000).optional();

export const ResolveCountriesInput = z.object({ places });

export const ResolveRouteInput = z.object({
  origins: places.optional().describe("Exporting countries or regions"),
  destinations: places.optional().describe("Importing countries or regions"),
  direction: direction.optional(),
});

export const GetCoverageInput = z.object({ countries: places, direction: direction.optional() });

export const GetFieldGapsInput = z.object({ countries: places, direction: direction.optional() });

export const GetSchemaInput = z.object({ country: z.string().min(1).max(80).describe("One country name or ISO code"), direction });

export const GetVolumeInput = z.object({
  countries: places,
  direction: direction.optional(),
  years: z.array(z.number().int().min(2000).max(2100)).max(10).optional().describe("Calendar years; all known years when omitted"),
});

export const GetPackagesInput = z.object({
  channels: z.array(z.enum(["api", "dashboard", "bulk", "enrichment"])).max(4).optional().describe("Which price lists; all when omitted"),
});

export const PriceQuoteInput = z.object({
  format: z.enum(["api", "dashboard", "bulk", "enrichment"]).describe("How the customer buys the data"),
  global_records: qty.describe("api: global shipment records"),
  country_records: qty.describe("api: country shipment records"),
  company_records: qty.describe("api: company records"),
  profiles: qty.describe("api: company profiles"),
  package: z.string().max(40).optional().describe("api: a package name, to see credits left on it"),
  records_per_month: qty.describe("dashboard: shipment records a month"),
  profiles_per_month: qty.describe("dashboard: company profiles a month"),
  contacts: qty.describe("dashboard: contacts"),
  bulk_price_usd: z.number().positive().max(10_000_000).optional().describe("bulk: a price already agreed, in USD"),
  bulk_scope: z.string().max(200).optional().describe("bulk: what the agreed price covers"),
  hs4_countries: z.array(z.string().max(60)).max(20).optional().describe("bulk: countries for standard HS4 packages"),
  hs4_codes: z.number().int().min(1).max(500).optional().describe("bulk: how many HS4 codes"),
  direction: z.enum(["import", "export"]).optional().describe("bulk: imports or exports"),
  country_datasets: z
    .array(
      z.object({
        country: z.string().min(1).max(60),
        historical_years: z.number().int().min(0).max(20).optional(),
        update_years: z.number().int().min(0).max(20).optional(),
      }),
    )
    .max(20)
    .optional()
    .describe("bulk: full country datasets with years of history and of updates"),
  contact_emails: qty.describe("api: contact email lookups"),
  contact_phones: qty.describe("api: contact phone lookups"),
  contact_search_pages: qty.describe("api: contact search pages"),
});

export const GetTermsInput = z.object({
  query: z.string().max(200).optional().describe("A topic, e.g. refunds, resale, credits, governing law"),
  agreement: z.enum(["licence", "reseller"]).optional(),
  clause_no: z.string().max(20).optional().describe('A clause number, e.g. "7.2"'),
  limit: z.number().int().min(1).max(10).optional(),
});

export const GetApiReferenceInput = z.object({
  query: z.string().max(100).optional().describe("An endpoint or topic; empty lists every endpoint"),
  limit: z.number().int().min(1).max(20).optional(),
});

export const GetSamplesInput = z.object({
  countries: places.optional(),
  dataset_ids: z.array(z.string().max(40)).max(40).optional(),
});

export const SearchKnowledgeInput = z.object({
  query: z.string().min(2).max(300).describe("The question or keywords"),
  collections: z.array(z.enum(KNOWLEDGE_COLLECTIONS)).max(10).optional().describe("Limit the search to these collections; all when omitted"),
  limit: z.number().int().min(1).max(12).optional().describe("Most results to return (default 6)"),
});

/** Every knowledge tool returns the sales assistant's result as is, under `data`. */
export const KnowledgeOutput = z.object({
  source: z.literal(KNOWLEDGE_SOURCE),
  data: z.unknown().describe("The answer. Rows or hits marked internal: true are for Bill of Lading Data staff only"),
  source_ids: z.array(z.string()).describe("Knowledge base entries the answer came from (table:id@version)"),
  notes: z.array(z.string()).describe("Gaps, conflicts, freshness and how to use the answer"),
});
