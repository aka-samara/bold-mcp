import { describe, expect, it } from "vitest";
import { compareTools, ourSchemas } from "../../scripts/knowledge-contract.ts";

describe("knowledge contract check", () => {
  it("finds no difference between identical tool lists", () => {
    expect(compareTools(ourSchemas(), ourSchemas())).toEqual([]);
  });

  it("ignores descriptions and additionalProperties", () => {
    const theirs = new Map([...ourSchemas()].map(([name, s]) => [name, { ...(s as object), description: "other words", additionalProperties: false }]));
    expect(compareTools(ourSchemas(), theirs)).toEqual([]);
  });

  it("reports missing tools and changed inputs", () => {
    const theirs = ourSchemas();
    theirs.delete("get_samples");
    theirs.set("new_tool", { type: "object" });
    const quote = theirs.get("price_quote") as { properties: Record<string, unknown> };
    theirs.set("price_quote", { ...quote, properties: { ...quote.properties, discount: { type: "number" } } });
    const problems = compareTools(ourSchemas(), theirs);
    expect(problems).toHaveLength(3);
    expect(problems.join("\n")).toMatch(/get_samples: offered here but not by the knowledge API/);
    expect(problems.join("\n")).toMatch(/new_tool: offered by the knowledge API but not here/);
    expect(problems.join("\n")).toMatch(/price_quote: input schema differs/);
  });
});
