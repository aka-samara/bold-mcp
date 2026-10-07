import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { setupServer } from "msw/node";
import { FREE_TOOLS } from "@bold-mcp/core";
import { createPartnerApiMock, type Scenario } from "../msw/handlers.ts";
import { BAD_KEY, callerFor, connectInMemory, FAKE_KEY, testDeps } from "../helpers/harness.ts";
import { SAMPLE_ARGS } from "../helpers/samples.ts";

const mock = createPartnerApiMock(undefined, { invalidKeys: [BAD_KEY] });
const server = setupServer(...mock.handlers);
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => mock.reset());
afterAll(() => server.close());

type CallResult = { isError?: boolean; content: { type: string; text?: string }[]; structuredContent?: Record<string, unknown> };

async function run(tool: string, args: Record<string, unknown>, key = FAKE_KEY) {
  const { deps, logs } = testDeps();
  const conn = await connectInMemory(deps, callerFor(key));
  try {
    const res = (await conn.client.callTool({ name: tool, arguments: args })) as CallResult;
    return { res, logs, text: res.content.map((c) => c.text ?? "").join("\n") };
  } finally {
    await conn.close();
  }
}


describe("free tools against fixtures", () => {
  it("has sample args for every free tool", () => {
    expect(Object.keys(SAMPLE_ARGS).sort()).toEqual(FREE_TOOLS.map((t) => t.name).sort());
  });

  it.each(Object.entries(SAMPLE_ARGS))("%s returns structured content with source", async (tool, args) => {
    const { res } = await run(tool, args);
    expect(res.isError, JSON.stringify(res.content)).toBeFalsy();
    expect(res.structuredContent?.source).toBe("Bill of Lading Data");
    expect(res.content[0]?.type).toBe("text");
  });

  it("get_filter_options uses search-filters, or shipping-filters with include_parties", async () => {
    const a = await run("get_filter_options", { type: "imp", hs_codes: ["940360"] });
    expect(mock.calls.at(-1)?.path).toBe("search-filters");
    expect(a.res.structuredContent?.importer_names).toBeUndefined();
    expect(JSON.stringify(a.res.structuredContent)).not.toContain("label_cn");
    const b = await run("get_filter_options", { type: "imp", hs_codes: ["940360"], include_parties: true, language: "zh" });
    expect(mock.calls.at(-1)?.path).toBe("shipping-filters");
    expect(b.res.structuredContent?.importer_names).toMatchObject({ items: ["ACME HOME FURNISHINGS LLC"] });
    expect(JSON.stringify(b.res.structuredContent)).toContain("label_cn");
  });

  it("search_products truncates long product text", async () => {
    const { res } = await run("search_products", SAMPLE_ARGS.search_products ?? {});
    const row = (res.structuredContent?.rows as Record<string, unknown>[])[0];
    expect(row?.products_truncated).toBe(true);
    expect(String(row?.name).length).toBeLessThanOrEqual(200);
    expect(row?.total_import_value).toBe(450000);
  });

  it("find_company_id returns company_id and sends only documented fields", async () => {
    const { res } = await run("find_company_id", { type: "imp", company_name: "acme", page_size: 2 });
    expect((res.structuredContent?.rows as Record<string, unknown>[])[0]).toEqual({ company_id: "cmp_synthetic_001", name: "ACME HOME FURNISHINGS LLC", domain: "acme.example", country: "US" });
    expect(mock.calls.at(-1)?.body).toEqual({ type: "imp", company_name: "acme", page_size: 2, page_no: 1 });
  });

  it("find_company_contacts never returns profile_pic or contact details", async () => {
    const { res } = await run("find_company_contacts", SAMPLE_ARGS.find_company_contacts ?? {});
    const text = JSON.stringify(res.structuredContent);
    expect(text).not.toContain("profile_pic");
    expect(text).not.toContain("@");
    expect((res.structuredContent?.rows as Record<string, unknown>[])[0]).toMatchObject({ contact_id: "ct_synthetic_001", available: { professional_emails: 1 } });
  });

  it("get_credit_balance reports the three pools", async () => {
    const { res, text } = await run("get_credit_balance", {});
    expect(res.structuredContent).toMatchObject({ data_credits: { remaining: 1000 }, contact_credits: { remaining: 100 }, kyb_credits: { remaining: 100 } });
    expect(text).toContain("data 1,000 of 1,000");
  });

  it("estimate_cost gives pool, worst case and confirmation need", async () => {
    const a = await run("estimate_cost", { tool: "list_importers", arguments: { page_size: 20 } });
    expect(a.res.structuredContent).toMatchObject({ pool: "data", max_credits: 300, pool_remaining: 1000, enough_credits: true, needs_confirmation: true });
    const b = await run("estimate_cost", { tool: "get_kyb_report", arguments: { sections: ["details"] } });
    expect(b.res.structuredContent).toMatchObject({ pool: "kyb", max_credits: 10, needs_confirmation: true });
    const c = await run("estimate_cost", { tool: "find_company_id", arguments: {} });
    expect(c.res.structuredContent).toMatchObject({ pool: null, max_credits: 0, needs_confirmation: false });
  });

  it("rejects input missing hs_codes/products/company_id without calling the API", async () => {
    const { res } = await run("get_market_insights", { type: "imp" });
    expect(res.isError).toBe(true);
    expect(mock.calls).toHaveLength(0);
  });
});

describe("error mapping", () => {
  const cases: [Scenario, string][] = [
    ["400", "date_range exceeds 12 months"],
    ["401", "API key not recognised"],
    ["403", "doesn't have access"],
    ["404", "run find_company_id first"],
    ["500", "unavailable right now"],
  ];
  it.each(cases)("API %s becomes a tool error", async (scenario, expected) => {
    mock.setScenario("insights", scenario);
    const { res, text } = await run("get_market_insights", { type: "imp", hs_codes: ["940360"] });
    expect(res.isError).toBe(true);
    expect(text).toContain(expected);
    if (scenario === "500") expect(mock.calls).toHaveLength(3);
  });

  it("an invalid header key gives the brief's message", async () => {
    const { res, text } = await run("get_credit_balance", {}, BAD_KEY);
    expect(res.isError).toBe(true);
    expect(text).toBe("API key not recognised — check the key in your client settings.");
  });

  it("an empty result is not an error", async () => {
    mock.setScenario("company-search-free", "empty");
    const { res, text } = await run("find_company_id", { type: "imp", company_name: "zzz" });
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent?.rows).toEqual([]);
    expect(text).toContain("No company matched");
  });
});

describe("local upstream rate limits", () => {
  it("company search free: 31st call in a minute is stopped locally and offers search_companies", async () => {
    const { deps } = testDeps();
    const conn = await connectInMemory(deps, callerFor(FAKE_KEY, { connectionId: null }));
    // Per-connection limit is 60/min, so 31 calls stay under it.
    let last: CallResult | undefined;
    for (let i = 0; i < 31; i++) last = (await conn.client.callTool({ name: "find_company_id", arguments: { type: "imp", company_name: "acme" } })) as CallResult;
    await conn.close();
    expect(mock.calls).toHaveLength(30);
    expect(last?.isError).toBe(true);
    expect(last?.content[0]?.text).toContain("search_companies");
  });

  it("contacts lite: 11th call in a minute is stopped locally and offers Pro mode", async () => {
    const { deps } = testDeps();
    const conn = await connectInMemory(deps, callerFor(FAKE_KEY));
    let last: CallResult | undefined;
    for (let i = 0; i < 11; i++) last = (await conn.client.callTool({ name: "find_company_contacts", arguments: { company_name: "acme" } })) as CallResult;
    await conn.close();
    expect(mock.calls).toHaveLength(10);
    expect(last?.content[0]?.text).toContain('volume="pro"');
  });

  it("per-connection limit: 61st tool call in a minute is refused", async () => {
    const { deps } = testDeps();
    const conn = await connectInMemory(deps, callerFor(FAKE_KEY));
    let last: CallResult | undefined;
    for (let i = 0; i < 61; i++) last = (await conn.client.callTool({ name: "get_credit_balance", arguments: {} })) as CallResult;
    await conn.close();
    expect(mock.calls).toHaveLength(60);
    expect(last?.content[0]?.text).toContain("limit 60 a minute");
  });
});
