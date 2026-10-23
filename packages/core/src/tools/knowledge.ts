import type { z } from "zod";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import {
  GetApiReferenceInput,
  GetCoverageInput,
  GetFieldGapsInput,
  GetPackagesInput,
  GetSamplesInput,
  GetSchemaInput,
  GetTermsInput,
  GetVolumeInput,
  KNOWLEDGE_SOURCE,
  KnowledgeOutput,
  PriceQuoteInput,
  ResolveCountriesInput,
  ResolveRouteInput,
  SearchKnowledgeInput,
} from "../schemas/knowledge.js";
import type { KnowledgeToolName } from "./names.js";
import { defineTool, type ToolDefinition } from "./types.js";

/**
 * Knowledge tools: read-only proxies for the sales assistant's knowledge base
 * (decision D49). Registered only when BOLD_KNOWLEDGE_URL and
 * BOLD_KNOWLEDGE_TOKEN are set. They never touch the Partner API or credits.
 */

/** Free and read-only, and the knowledge base is a closed set of facts. */
const KNOWLEDGE_READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

const COST = "Free, 0 credits (Bill of Lading Data knowledge base).";
const INTERNAL = "Rows marked internal: true are for Bill of Lading Data staff only; never quote them to a customer.";

function knowledgeTool<I extends z.ZodObject>(name: KnowledgeToolName, title: string, description: string, inputSchema: I) {
  return defineTool({
    name,
    title,
    description: `${COST}\n${description}`,
    inputSchema,
    outputSchema: KnowledgeOutput,
    annotations: KNOWLEDGE_READ_ONLY,
    endpoints: [],
    knowledge: true,
    async handler(args, rt) {
      const r = await rt.knowledge(name, args as Record<string, unknown>);
      const sources = r.source_ids.length;
      const notes = r.notes.length ? `, with ${r.notes.length} note${r.notes.length === 1 ? "" : "s"}` : "";
      return {
        structured: { source: KNOWLEDGE_SOURCE, data: r.data, source_ids: r.source_ids, notes: r.notes },
        summary: `${title}: answer from ${sources} knowledge base entr${sources === 1 ? "y" : "ies"}${notes}.`,
      };
    },
  });
}

export const searchKnowledge = knowledgeTool(
  "search_knowledge",
  "Search the knowledge base",
  "Start here for any question about Bill of Lading Data itself. Searches FAQs, objections, proof points, competitors, policies, products, coverage, pricing rules, data quality, qualification, escalation, never-promise rules, use cases and the uploaded guides (pricing, API). Hits marked to_confirm are not confirmed facts; team_correction hits override older entries. " +
    INTERNAL,
  SearchKnowledgeInput,
);

export const resolveCountries = knowledgeTool(
  "resolve_countries",
  "Resolve countries",
  "Turns country names, aliases, ISO codes or regions (GCC, EU, Southeast Asia) into ISO codes. Call it first when a question names a region or an unusual country name.",
  ResolveCountriesInput,
);

export const resolveRoute = knowledgeTool(
  "resolve_route",
  "Trade route coverage",
  "Where the records for a trade route come from: visible from both sides, through the importer's or the exporter's records, or not covered. With one side only, says whether that country's imports or exports are direct or mirror data. Includes freshness and open data conflicts. Use it for questions like \"do you have shipments from Vietnam to the US?\". " +
    INTERNAL,
  ResolveRouteInput,
);

export const getCoverage = knowledgeTool(
  "get_coverage",
  "Country coverage",
  "Direct and mirror coverage per country: source type, years of history, latest data month, update frequency, lag, channels, missing fields and whether the data is still updating. " +
    INTERNAL,
  GetCoverageInput,
);

export const getFieldGaps = knowledgeTool(
  "get_field_gaps",
  "Missing fields by country",
  "Which key fields (importer, exporter, HS code, product description, quantity, weight, declared value, origin/destination) are missing or partial in each country's data.",
  GetFieldGapsInput,
);

export const getSchema = knowledgeTool(
  "get_schema",
  "Country data dictionary",
  "The data-dictionary fields for one country's imports or exports, with canonical names and meanings.",
  GetSchemaInput,
);

export const getVolume = knowledgeTool(
  "get_volume",
  "Yearly record counts",
  "Yearly record counts per country and direction (knowledge base estimates), with records per update. For live counts for a product or company, use get_market_insights instead.",
  GetVolumeInput,
);

export const getPackages = knowledgeTool(
  "get_packages",
  "Prices and packages",
  "Bill of Lading Data's price lists: API credit costs, packages and contact credit packs, dashboard plans and add-ons, bulk HS4 and full-country dataset prices, and enrichment pricing rules. For a total, call price_quote.",
  GetPackagesInput,
);

export const priceQuote = knowledgeTool(
  "price_quote",
  "Price quote",
  "Calculates what a customer would pay. api: credits per record type, total credits, the cheapest package that covers them, setup fee and validity; contact_emails, contact_phones and contact_search_pages add contact credits and the cheapest contact pack. dashboard: the plan that fits monthly records and profiles. bulk: an agreed price, standard HS4 packages (hs4_countries, hs4_codes, direction) or full country datasets (country_datasets). enrichment: custom quote. Never do price arithmetic yourself. (estimate_cost is different: it estimates credits for a call on this server.)",
  PriceQuoteInput,
);

export const getTerms = knowledgeTool(
  "get_terms",
  "Licence and reseller terms",
  "Finds clauses in the licence or reseller agreement by topic (refunds, resale, credits, governing law) or clause number, with plain summaries.",
  GetTermsInput,
);

export const getApiReference = knowledgeTool(
  "get_api_reference",
  "Partner API reference",
  "Partner API documentation: base URL, auth header, endpoint paths, credit costs, rate limits, request rules and pagination. Leave query empty to list every endpoint; name one endpoint to get its parameters and response fields.",
  GetApiReferenceInput,
);

export const getSamples = knowledgeTool(
  "get_samples",
  "Sample sheets",
  "Which sample sheets exist for countries or datasets: sheet names, row counts and columns. Never returns sample rows.",
  GetSamplesInput,
);

/** In the order clients list them: the general search first. */
export const KNOWLEDGE_TOOLS: readonly ToolDefinition[] = [
  searchKnowledge,
  resolveCountries,
  resolveRoute,
  getCoverage,
  getFieldGaps,
  getSchema,
  getVolume,
  getPackages,
  priceQuote,
  getTerms,
  getApiReference,
  getSamples,
] as unknown as readonly ToolDefinition[];
