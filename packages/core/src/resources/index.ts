import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CostTable, ToolCost } from "../billing/costs.js";
import { CONTACT_ROLES, TRANSPORT_TYPES } from "../schemas/common.js";
import { COUNTRIES } from "./countries.js";

function costLine(tool: string, c: ToolCost): string {
  switch (c.unit) {
    case "free":
      return `- ${tool}: free`;
    case "per_record":
      return `- ${tool}: ${c.credits} ${c.pool} credit${c.credits === 1 ? "" : "s"} per record returned (default page size ${c.default_page_size})`;
    case "per_page":
      return `- ${tool}: ${c.credits} ${c.pool} credits per page returned`;
    case "per_request":
      return `- ${tool}: ${c.credits} ${c.pool} credits per request that returns data`;
    case "per_section":
      return `- ${tool}: ${c.credits} ${c.pool} credits per section returned`;
    case "per_lookup":
      return `- ${tool}: per person, ${Object.entries(c.lookups).map(([k, v]) => `${k} ${v}`).join(", ")} ${c.pool} credits, charged only when returned`;
  }
}

export function pricingText(costs: CostTable): string {
  const lines = Object.entries(costs).map(([tool, c]) =>
    costLine(tool === "find_company_contacts_pro" ? 'find_company_contacts (volume="pro")' : tool, c),
  );
  return [
    "# Bill of Lading Data credits",
    "",
    "Your account has three separate credit pools. Calls through this server cost exactly what the same API call costs.",
    "",
    "- Data credits: shipment records, importer/exporter lists, company search with totals, competitors, company profiles.",
    "- Contact credits: Pro contact lists and contact unlocks (emails, phones).",
    "- KYB credits: registry search and KYB reports (details, financials, shareholders, officers).",
    "",
    "Credits are charged only when data is returned; failed or empty calls are free.",
    "Before a paid call the server checks the pool balance and your per-call limit, and asks you to confirm when needed. Contact and KYB unlocks always ask.",
    "",
    "## Price per tool",
    "",
    ...lines,
  ].join("\n");
}

export const WORKFLOWS = `# Common workflows

Use free tools first: get_market_insights, get_filter_options, search_products, find_company_id.

## Find buyers for a product
1. search_products or get_filter_options to get HS codes (free).
2. get_market_insights for market size and top importing countries (free).
3. list_importers with hs_codes and import_countries (paid, data credits).
4. check_logistics_company on promising buyers to skip freight forwarders (free).
5. find_company_contacts for masked contact previews (free).

## Find suppliers
get_market_insights → list_exporters → get_company_profile.

## Size a market
search_products → get_market_insights.

## Look up a shipment's companies
search_shipments → take shipper_name / consignee_name → find_company_id (free).
Shipment import_id / export_id are record ids, never company ids.

## Supplier due diligence
find_company_id → get_company_profile → search_kyb → get_kyb_report (asks for confirmation).

## Competitor scan
find_company_id → find_competitors → get_market_insights.

## What did I spend?
get_credit_balance → get_credit_history.
`;

export function registerResources(server: McpServer, costs: CostTable): void {
  const text = (uri: string, body: string, mimeType = "text/markdown") => ({ contents: [{ uri, mimeType, text: body }] });

  server.registerResource("pricing", "bold://pricing", { title: "Credit pricing", description: "The cost of each tool and the three credit pools, in plain words", mimeType: "text/markdown" }, (uri) =>
    text(uri.href, pricingText(costs)),
  );
  server.registerResource("countries", "bold://reference/countries", { title: "Country codes", description: "2-letter ISO country codes and names", mimeType: "application/json" }, (uri) =>
    text(uri.href, JSON.stringify(COUNTRIES.map(([code, name]) => ({ code, name }))), "application/json"),
  );
  server.registerResource("transport-types", "bold://reference/transport-types", { title: "Transport types", description: "Allowed transport_types values", mimeType: "application/json" }, (uri) =>
    text(uri.href, JSON.stringify(TRANSPORT_TYPES), "application/json"),
  );
  server.registerResource("contact-roles", "bold://reference/contact-roles", { title: "Contact roles", description: "Allowed roles values for find_company_contacts", mimeType: "application/json" }, (uri) =>
    text(uri.href, JSON.stringify(CONTACT_ROLES), "application/json"),
  );
  server.registerResource("workflows", "bold://guide/workflows", { title: "Workflows", description: "Which tools to chain for common questions", mimeType: "text/markdown" }, (uri) =>
    text(uri.href, WORKFLOWS),
  );
}
