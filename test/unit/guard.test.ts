import { describe, expect, it } from "vitest";
import { creditsUsed, decide, DEFAULT_COSTS, DEFAULT_SETTINGS, type GuardInput } from "@bold-mcp/core";

const base = (over: Partial<GuardInput> = {}): GuardInput => ({
  estimate: { tool: "list_importers", pool: "data", max_credits: 30, basis: "2 records × 15 credits" },
  isUnlock: false,
  settings: { ...DEFAULT_SETTINGS },
  maxCreditsArg: undefined,
  spentToday: 0,
  remaining: 1000,
  ...over,
});

describe("credit guard", () => {
  it("lets a call within balance and limits go ahead", () => {
    expect(decide(base())).toEqual({ action: "proceed" });
  });

  it("refuses when the worst case exceeds the pool balance, naming pool and balance", () => {
    const d = decide(base({ remaining: 20 }));
    expect(d.action).toBe("refuse");
    expect(d.action === "refuse" && d.message).toContain("Not enough data credits — you have 20 left");
    expect(d.action === "refuse" && d.message).toContain("smaller page_size");
  });

  it("goes ahead when the balance is unknown and within limits", () => {
    expect(decide(base({ remaining: null })).action).toBe("proceed");
  });

  it("asks above the per-call limit (default 150)", () => {
    const d = decide(base({ estimate: { tool: "list_importers", pool: "data", max_credits: 165, basis: "11 records × 15 credits" } }));
    expect(d.action).toBe("confirm");
    expect(d.action === "confirm" && d.reasons.join()).toContain("per-call limit of 150");
    expect(decide(base({ estimate: { tool: "x", pool: "data", max_credits: 150, basis: "" } })).action).toBe("proceed");
  });

  it("uses the lower of the connection limit and max_credits", () => {
    expect(decide(base({ maxCreditsArg: 20 })).action).toBe("confirm");
    expect(decide(base({ maxCreditsArg: 500, settings: { ...DEFAULT_SETTINGS, perCallLimit: 10 } })).action).toBe("confirm");
  });

  it("asks when the call would pass the daily limit", () => {
    const d = decide(base({ spentToday: 1980 }));
    expect(d.action === "confirm" && d.reasons.join()).toContain("daily limit of 2000");
  });

  it("always asks for unlocks, even when cheap", () => {
    const d = decide(base({ isUnlock: true, estimate: { tool: "reveal_contact_details", pool: "contact", max_credits: 10, basis: "" } }));
    expect(d.action).toBe("confirm");
  });

  it("refuses unlocks that the connection turned off", () => {
    expect(decide(base({ isUnlock: true, estimate: { tool: "reveal_contact_details", pool: "contact", max_credits: 10, basis: "" }, settings: { ...DEFAULT_SETTINGS, allowContactUnlocks: false } })).action).toBe("refuse");
    expect(decide(base({ isUnlock: true, estimate: { tool: "get_kyb_report", pool: "kyb", max_credits: 10, basis: "" }, settings: { ...DEFAULT_SETTINGS, allowKybUnlocks: false } })).action).toBe("refuse");
  });
});

describe("credits used", () => {
  it("multiplies what was returned by the unit price", () => {
    expect(creditsUsed(DEFAULT_COSTS.list_importers, { units: 2 })).toBe(30);
    expect(creditsUsed(DEFAULT_COSTS.search_shipments, { units: 0 })).toBe(0);
    expect(creditsUsed(DEFAULT_COSTS.find_company_contacts_pro, { units: 1 })).toBe(2);
    expect(creditsUsed(DEFAULT_COSTS.get_kyb_report, { units: 3 })).toBe(30);
    expect(creditsUsed(DEFAULT_COSTS.reveal_contact_details, { lookups: ["professional_emails", "phones"] })).toBe(25);
    expect(creditsUsed(DEFAULT_COSTS.get_market_insights, { units: 5 })).toBe(0);
  });
});
