import { describe, expect, it } from "vitest";
import { ENDPOINTS, getEndpoint } from "@bold-mcp/core";

describe("endpoint catalogue", () => {
  it("has the 22 global paths across 16 tabs", () => {
    expect(ENDPOINTS).toHaveLength(22);
    expect(new Set(ENDPOINTS.map((e) => e.path)).size).toBe(22);
    expect(new Set(ENDPOINTS.map((e) => e.tab.replace(/[a-z]$/, ""))).size).toBe(16);
  });

  it("has 9 free and 13 paid paths", () => {
    expect(ENDPOINTS.filter((e) => e.charge === "free")).toHaveLength(9);
    expect(ENDPOINTS.filter((e) => e.charge !== "free")).toHaveLength(13);
  });

  it("maps every paid path to a pool and every free path to none", () => {
    for (const e of ENDPOINTS) {
      if (e.charge === "free") expect(e.pool, e.path).toBeNull();
      else expect(e.pool, e.path).not.toBeNull();
    }
  });

  it("charges the pools the team confirmed", () => {
    expect(getEndpoint("advanced-company-contacts").pool).toBe("contact");
    expect(getEndpoint("contact-look-up").pool).toBe("contact");
    expect(getEndpoint("kyb-search")).toMatchObject({ pool: "kyb", unitCredits: 3 });
    for (const p of ["advanced-kyb-search", "financial-kyb", "shareholders-kyb", "officers-kyb"] as const) {
      expect(getEndpoint(p)).toMatchObject({ pool: "kyb", unitCredits: 10 });
    }
    expect(getEndpoint("company-details")).toMatchObject({ pool: "data", unitCredits: 20 });
  });

  it("keeps paths relative with no slashes", () => {
    for (const e of ENDPOINTS) expect(e.path).toMatch(/^[a-z-]+$/);
  });
});
