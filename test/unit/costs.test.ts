import { describe, expect, it } from "vitest";
import { DEFAULT_COSTS, estimateCost, loadCostTable, nextPageCost, TOOL_NAMES } from "@bold-mcp/core";

const table = loadCostTable({});

describe("cost table", () => {
  it("prices every tool", () => {
    for (const name of TOOL_NAMES) expect(estimateCost(table, name, {}), name).not.toBeNull();
  });

  it("matches the brief's worst-case table", () => {
    expect(estimateCost(table, "get_market_insights", {})).toMatchObject({ pool: null, max_credits: 0 });
    expect(estimateCost(table, "find_company_contacts", {})).toMatchObject({ pool: null, max_credits: 0 });
    expect(estimateCost(table, "find_company_contacts", { volume: "pro" })).toMatchObject({ pool: "contact", max_credits: 2 });
    expect(estimateCost(table, "search_kyb", {})).toMatchObject({ pool: "kyb", max_credits: 3 });
    expect(estimateCost(table, "search_shipments", { page_size: 7 })).toMatchObject({ pool: "data", max_credits: 7 });
    expect(estimateCost(table, "search_shipments", {})).toMatchObject({ max_credits: 10 });
    for (const t of ["list_importers", "list_exporters"]) expect(estimateCost(table, t, { page_size: 2 })).toMatchObject({ pool: "data", max_credits: 30 });
    for (const t of ["search_companies", "find_competitors"]) expect(estimateCost(table, t, {})).toMatchObject({ pool: "data", max_credits: 75 });
    expect(estimateCost(table, "get_company_profile", {})).toMatchObject({ pool: "data", max_credits: 20 });
    expect(estimateCost(table, "reveal_contact_details", { lookup_type: ["professional_emails", "personal_emails", "phones"] })).toMatchObject({ pool: "contact", max_credits: 35 });
    expect(estimateCost(table, "reveal_contact_details", { lookup_type: ["phones", "phones"] })).toMatchObject({ max_credits: 15 });
    expect(estimateCost(table, "get_kyb_report", { sections: ["details", "financials", "officers"] })).toMatchObject({ pool: "kyb", max_credits: 30 });
  });

  it("returns null for unknown tools", () => {
    expect(estimateCost(table, "nope", {})).toBeNull();
  });

  it("gives the next page's cost", () => {
    expect(nextPageCost(table, "list_importers", { page_size: 2, page_no: 1 })).toBe(30);
    expect(nextPageCost(table, "find_company_id", { page_size: 2 })).toBe(0);
  });

  it("can be overridden from BOLD_COSTS_JSON", () => {
    const t = loadCostTable({ BOLD_COSTS_JSON: JSON.stringify({ get_company_profile: { unit: "per_request", pool: "data", credits: 25 } }) });
    expect(estimateCost(t, "get_company_profile", {})?.max_credits).toBe(25);
    expect(t.search_kyb).toEqual(DEFAULT_COSTS.search_kyb);
  });

  it("rejects bad overrides", () => {
    expect(() => loadCostTable({ BOLD_COSTS_JSON: "{" })).toThrow(/not valid JSON/);
    expect(() => loadCostTable({ BOLD_COSTS_JSON: JSON.stringify({ nope: { unit: "free" } }) })).toThrow(/unknown tool/);
    expect(() => loadCostTable({ BOLD_COSTS_JSON: JSON.stringify({ search_kyb: { unit: "per_request", pool: "gold", credits: 3 } }) })).toThrow(/invalid/);
  });
});
