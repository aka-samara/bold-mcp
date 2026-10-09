import { describe, expect, it } from "vitest";
import { z } from "zod";
import { FREE_TOOLS } from "@bold-mcp/core";

const schemaOf = (name: string) => {
  const t = FREE_TOOLS.find((x) => x.name === name);
  if (!t) throw new Error(name);
  return t.inputSchema;
};

describe("TradeFilter validation", () => {
  const insights = schemaOf("get_market_insights");

  it("requires one of hs_codes, products or company_id", () => {
    expect(insights.safeParse({ type: "imp" }).success).toBe(false);
    expect(insights.safeParse({ type: "imp", hs_codes: ["940360"] }).success).toBe(true);
    expect(insights.safeParse({ type: "imp", company_id: "c1" }).success).toBe(true);
  });

  it("rejects a date_range over 12 months with the exact message", () => {
    const r = insights.safeParse({ type: "imp", hs_codes: ["9403"], date_range: { start_date: "2025-01-01", end_date: "2026-01-02" } });
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain("date_range exceeds 12 months");
    expect(insights.safeParse({ type: "imp", hs_codes: ["9403"], date_range: { start_date: "2025-01-01", end_date: "2026-01-01" } }).success).toBe(true);
  });

  it("rejects end before start and bad dates", () => {
    expect(insights.safeParse({ type: "imp", hs_codes: ["9403"], date_range: { start_date: "2026-02-01", end_date: "2026-01-01" } }).success).toBe(false);
    expect(insights.safeParse({ type: "imp", hs_codes: ["9403"], date_range: { start_date: "2026-13-01", end_date: "2026-12-01" } }).success).toBe(false);
  });

  it("upper-cases country codes and rejects names", () => {
    const r = insights.parse({ type: "imp", hs_codes: ["9403"], import_countries: ["us"] }) as { import_countries: string[] };
    expect(r.import_countries).toEqual(["US"]);
    expect(insights.safeParse({ type: "imp", hs_codes: ["9403"], import_countries: ["USA"] }).success).toBe(false);
  });

  it("only allows documented transport types", () => {
    expect(insights.safeParse({ type: "imp", hs_codes: ["9403"], transport_types: ["sea", "power transmission"] }).success).toBe(true);
    expect(insights.safeParse({ type: "imp", hs_codes: ["9403"], transport_types: ["boat"] }).success).toBe(false);
  });
});

describe("contacts input", () => {
  const contacts = schemaOf("find_company_contacts");
  it("needs company_id with type, or company_name", () => {
    expect(contacts.safeParse({}).success).toBe(false);
    expect(contacts.safeParse({ company_id: "c1" }).success).toBe(false);
    expect(contacts.safeParse({ company_id: "c1", type: "imp" }).success).toBe(true);
    expect(contacts.safeParse({ company_name: "Acme" }).success).toBe(true);
  });
});

describe("JSON Schema export", () => {
  it("every free tool's input and output converts to JSON Schema", () => {
    for (const t of FREE_TOOLS) {
      expect(() => z.toJSONSchema(t.inputSchema, { io: "input" }), t.name).not.toThrow();
      expect(() => z.toJSONSchema(t.outputSchema), t.name).not.toThrow();
    }
  });
});
