import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

const userText = (text: string) => ({ messages: [{ role: "user" as const, content: { type: "text" as const, text } }] });
const product = z.string().min(1).max(200).describe("Product description or HS code");

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    "find_buyers",
    { title: "Find buyers", description: "Find importers of a product in a target country", argsSchema: { product, country: z.string().min(2).max(60).describe("Target country (name or 2-letter code)") } },
    ({ product, country }) =>
      userText(
        `Find buyers of "${product}" in ${country} using Bill of Lading Data.\n` +
          "1. Use get_market_insights (free) to size the market and confirm the HS codes; use search_products or get_filter_options if you need HS codes or the country code.\n" +
          "2. Use list_importers for the top buyers in that country (paid: state the cost and keep page_size small).\n" +
          "3. Use check_logistics_company (free) on the top results and flag freight forwarders.\n" +
          "4. Use find_company_contacts (free previews) for the best two or three buyers.\n" +
          "Report credits used and remaining after each paid call. Do not unlock contact details unless I ask.",
      ),
  );
  server.registerPrompt(
    "find_suppliers",
    { title: "Find suppliers", description: "Find exporters of a product from an origin country", argsSchema: { product, origin_country: z.string().min(2).max(60).describe("Origin country (name or 2-letter code)") } },
    ({ product, origin_country }) =>
      userText(
        `Find suppliers of "${product}" exporting from ${origin_country} using Bill of Lading Data.\n` +
          "1. get_market_insights (free) for the market and top exporter countries.\n" +
          "2. list_exporters filtered to that origin (paid: state the cost, small page_size).\n" +
          "3. get_company_profile for the most promising one or two (paid, 20 data credits each), after asking me.\n" +
          "Report credits used and remaining after each paid call.",
      ),
  );
  server.registerPrompt(
    "market_size",
    {
      title: "Market size",
      description: "Size the market for a product in a country and period",
      argsSchema: { product, country: z.string().min(2).max(60), period: z.string().min(2).max(60).describe("Period, e.g. \"last 12 months\" or \"2025\" (at most 12 months)") },
    },
    ({ product, country, period }) =>
      userText(
        `Size the market for "${product}" in ${country} over ${period} using Bill of Lading Data.\n` +
          "1. search_products (free) to find the right HS codes.\n" +
          "2. get_market_insights (free) with those HS codes, the country and a date_range of at most 12 months.\n" +
          "Summarise total value, shipments, number of importers and suppliers, and the top partner countries. Use only free tools.",
      ),
  );
  server.registerPrompt(
    "supplier_due_diligence",
    { title: "Supplier due diligence", description: "Check a supplier's trade profile and registry record", argsSchema: { company_name: z.string().min(2).max(200), country: z.string().min(2).max(60) } },
    ({ company_name, country }) =>
      userText(
        `Run due diligence on ${company_name} (${country}) using Bill of Lading Data.\n` +
          "1. find_company_id (free) to get the company_id.\n" +
          "2. get_company_profile (20 data credits) for its trade profile.\n" +
          "3. search_kyb (3 KYB credits) to find its registry record.\n" +
          "4. get_kyb_report only after I confirm which sections I want (10 KYB credits per section).\n" +
          "Report credits used and remaining after each paid call.",
      ),
  );
  server.registerPrompt(
    "competitor_scan",
    { title: "Competitor scan", description: "Find a company's competitors and their market", argsSchema: { company_name: z.string().min(2).max(200) } },
    ({ company_name }) =>
      userText(
        `Scan competitors of ${company_name} using Bill of Lading Data.\n` +
          "1. find_company_id (free) to get the company_id.\n" +
          "2. find_competitors (paid: 15 data credits per competitor; keep page_size small).\n" +
          "3. get_market_insights (free) with the company_id for context.\n" +
          "Report credits used and remaining after each paid call.",
      ),
  );
  server.registerPrompt(
    "my_usage",
    { title: "My usage", description: "Show credit balances and recent spending", argsSchema: { period: z.string().max(60).optional().describe('e.g. "today", "this week"') } },
    ({ period }) =>
      userText(
        `Show my Bill of Lading Data credit balances and what was spent${period ? ` ${period}` : " recently"}.\n` +
          "1. get_credit_balance for the three pools.\n" +
          "2. get_credit_history for recent charges, grouped by pool and action.",
      ),
  );
}
