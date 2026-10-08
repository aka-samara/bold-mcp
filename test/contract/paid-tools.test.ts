import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { setupServer } from "msw/node";
import { DEFAULT_SETTINGS, PAID_TOOLS } from "@bold-mcp/core";
import { createPartnerApiMock } from "../msw/handlers.ts";
import { callerFor, connectInMemory, FAKE_KEY, testDeps } from "../helpers/harness.ts";
import { PAID_SAMPLE_ARGS } from "../helpers/samples.ts";

const mock = createPartnerApiMock();
const server = setupServer(...mock.handlers);
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => mock.reset());
afterAll(() => server.close());

type Result = { isError?: boolean; content: { text: string }[]; structuredContent?: Record<string, unknown> };

async function session(opts: Parameters<typeof connectInMemory>[2] = {}, settings = DEFAULT_SETTINGS) {
  const { deps, logs } = testDeps();
  const conn = await connectInMemory(deps, callerFor(FAKE_KEY, { settings }), opts);
  const call = async (name: string, args: Record<string, unknown>) => (await conn.client.callTool({ name, arguments: args })) as Result;
  return { ...conn, call, deps, logs };
}

const pathCalls = (p: string) => mock.calls.filter((c) => c.path === p).length;
const balances = (data: number, contact = 100, kyb = 100) => ({
  code: 200,
  message: "Success",
  data: { credits: { data_credits: { total: 1000, used: 1000 - data, remaining: data }, contact_credits: { total: 100, used: 100 - contact, remaining: contact }, kyb_credits: { total: 100, used: 100 - kyb, remaining: kyb } } },
});

describe("paid tools within limits", () => {
  it("has sample args for every paid tool", () => {
    expect(Object.keys(PAID_SAMPLE_ARGS).sort()).toEqual(PAID_TOOLS.map((t) => t.name).sort());
  });

  it.each(Object.entries(PAID_SAMPLE_ARGS))("%s calls the API and reports credits", async (tool, args) => {
    const s = await session();
    const r = await s.call(tool, args);
    await s.close();
    expect(r.isError, r.content[0]?.text).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ source: "Bill of Lading Data", status: "ok", credits_used_is_estimate: true });
    expect(typeof r.structuredContent?.credits_used).toBe("number");
    expect(r.structuredContent?.credits_remaining).toBe(tool === "search_kyb" ? 100 : 1000);
    expect(r.content[0]?.text).toMatch(/Credits used: \d+ (data|KYB) \(estimated\); [\d,]+ (data|KYB) credits remaining\./);
  });

  it("charges per record returned and reports the next page's cost", async () => {
    const s = await session();
    const r = await s.call("list_importers", { hs_codes: ["940360"], page_size: 2 });
    await s.close();
    // The fixture returns one importer.
    expect(r.structuredContent).toMatchObject({ pool: "data", credits_used: 15, next_page_cost_credits: 30 });
    expect(mock.calls.find((c) => c.path === "all-importers")?.body).toEqual({ hs_codes: ["940360"], page_size: 2, page_no: 1 });
  });

  it("labels shipment ids as record ids and keeps names for find_company_id", async () => {
    const s = await session();
    const r = await s.call("search_shipments", { type: "imp", hs_codes: ["940360"], page_size: 1 });
    await s.close();
    const row = (r.structuredContent?.rows as Record<string, unknown>[])[0];
    expect(row).toMatchObject({ date: "2026-08-15", import_record_id: "rec-imp-0001", export_record_id: "rec-exp-0001", consignee_name: "ACME HOME FURNISHINGS LLC", amount: 12500, brands: null });
    expect(row).not.toHaveProperty("import_id");
    expect(row).not.toHaveProperty("bydate");
  });

  it("charges nothing for an empty result", async () => {
    mock.setScenario("all-exporters", "empty");
    const s = await session();
    const r = await s.call("list_exporters", { hs_codes: ["940360"], page_size: 2 });
    await s.close();
    expect(r.structuredContent).toMatchObject({ status: "ok", credits_used: 0, rows: [] });
  });

  it("Pro contacts use the contact pool, 2 credits per page", async () => {
    const s = await session();
    const r = await s.call("find_company_contacts", { company_id: "cmp_synthetic_001", type: "imp", page_size: 2, volume: "pro" });
    const lite = await s.call("find_company_contacts", { company_id: "cmp_synthetic_001", type: "imp", page_size: 2 });
    await s.close();
    expect(pathCalls("advanced-company-contacts")).toBe(1);
    expect(r.structuredContent).toMatchObject({ mode: "pro", pool: "contact", credits_used: 2, credits_remaining: 100 });
    expect(lite.structuredContent).toMatchObject({ mode: "lite", pool: null, credits_used: 0 });
  });
});

describe("pool balance pre-check", () => {
  it("never calls the API when the worst case exceeds the pool balance", async () => {
    mock.setResponse("credit-usage", 200, balances(20));
    const s = await session();
    const r = await s.call("list_importers", { hs_codes: ["940360"], page_size: 2 });
    await s.close();
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toContain("Not enough data credits — you have 20 left");
    expect(pathCalls("all-importers")).toBe(0);
  });

  it("reads balances from Credit Usage once per minute per key", async () => {
    const s = await session();
    await s.call("get_company_profile", { type: "imp", company_id: "c1" });
    const before = pathCalls("credit-usage");
    await s.call("search_kyb", { company_id: "c1", type: "imp" });
    await s.close();
    // Before the call: cached; after a charge: refreshed once.
    expect(pathCalls("credit-usage") - before).toBe(1);
  });

  it("maps an API 402 to a tool error naming the pool and balance", async () => {
    mock.setScenario("company-details", "402");
    const s = await session();
    const r = await s.call("get_company_profile", { type: "imp", company_id: "c1" });
    await s.close();
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toContain("Not enough data credits for this call (1,000 left)");
  });
});

describe("confirmation", () => {
  const big = { hs_codes: ["940360"], page_size: 20 }; // 300 credits > 150

  it("returns confirmation_required above the per-call limit without calling the API", async () => {
    const s = await session();
    const r = await s.call("list_importers", big);
    await s.close();
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ status: "confirmation_required", pool: "data", confirmation: { estimated_max_credits: 300, pool_remaining: 1000 } });
    expect(String((r.structuredContent?.confirmation as Record<string, unknown>).confirmation_token)).toMatch(/^ey/);
    expect(pathCalls("all-importers")).toBe(0);
  });

  it("goes ahead with the token once, for the same arguments only", async () => {
    const s = await session();
    const first = await s.call("list_importers", big);
    const token = (first.structuredContent?.confirmation as { confirmation_token: string }).confirmation_token;

    const other = await s.call("list_importers", { ...big, page_size: 19, confirmation_token: token });
    expect(other.structuredContent?.status).toBe("confirmation_required");
    expect(other.content[0]?.text).toContain("different call");

    const ok = await s.call("list_importers", { ...big, confirmation_token: token });
    expect(ok.structuredContent?.status).toBe("ok");
    expect(pathCalls("all-importers")).toBe(1);

    const again = await s.call("list_importers", { ...big, confirmation_token: token });
    expect(again.structuredContent?.status).toBe("confirmation_required");
    expect(again.content[0]?.text).toContain("already used");
    expect(pathCalls("all-importers")).toBe(1);
    await s.close();
  });

  it("a token from another connection does not work", async () => {
    const a = await session();
    const token = ((await a.call("list_importers", big)).structuredContent?.confirmation as { confirmation_token: string }).confirmation_token;
    await a.close();
    const { deps } = testDeps();
    const b = await connectInMemory(deps, callerFor(FAKE_KEY.replace("tk", "zz")));
    const r = (await b.client.callTool({ name: "list_importers", arguments: { ...big, confirmation_token: token } })) as Result;
    await b.close();
    expect(r.structuredContent?.status).toBe("confirmation_required");
    expect(pathCalls("all-importers")).toBe(0);
  });

  it("respects a lower max_credits from the AI", async () => {
    const s = await session();
    const r = await s.call("get_company_profile", { type: "imp", company_id: "c1", max_credits: 10 });
    await s.close();
    expect(r.structuredContent?.status).toBe("confirmation_required");
    expect(pathCalls("company-details")).toBe(0);
  });

  it("respects the connection's per-call limit setting", async () => {
    const s = await session({}, { ...DEFAULT_SETTINGS, perCallLimit: 5 });
    const r = await s.call("search_shipments", { type: "imp", hs_codes: ["940360"], page_size: 10 });
    await s.close();
    expect(r.structuredContent?.status).toBe("confirmation_required");
  });

  it("asks once the daily limit would be passed", async () => {
    const s = await session({}, { ...DEFAULT_SETTINGS, dailyLimit: 30 });
    const a = await s.call("get_company_profile", { type: "imp", company_id: "c1" });
    const b = await s.call("get_company_profile", { type: "imp", company_id: "c1" });
    await s.close();
    expect(a.structuredContent?.status).toBe("ok");
    expect(b.structuredContent?.status).toBe("confirmation_required");
    expect(b.content[0]?.text).toContain("Go ahead?");
    expect(JSON.stringify(b.structuredContent)).toContain("daily limit of 30");
  });

  it("uses elicitation when the client supports it: accept", async () => {
    let asked = "";
    const s = await session({ elicit: () => ({ action: "accept", content: { confirm: true } }) });
    s.client.setRequestHandler((await import("@modelcontextprotocol/sdk/types.js")).ElicitRequestSchema, async (req) => {
      asked = String(req.params.message);
      return { action: "accept", content: { confirm: true } };
    });
    const r = await s.call("list_importers", big);
    await s.close();
    expect(asked).toContain("up to 300 data credits");
    expect(r.structuredContent?.status).toBe("ok");
    expect(pathCalls("all-importers")).toBe(1);
  });

  it("uses elicitation when the client supports it: decline", async () => {
    const s = await session({ elicit: () => ({ action: "decline" }) });
    const r = await s.call("list_importers", big);
    await s.close();
    expect(r.structuredContent).toMatchObject({ status: "cancelled" });
    expect(pathCalls("all-importers")).toBe(0);
  });

  it("estimate_cost agrees with the guard", async () => {
    const s = await session();
    const a = await s.call("estimate_cost", { tool: "list_importers", arguments: big });
    const b = await s.call("estimate_cost", { tool: "list_importers", arguments: { ...big, page_size: 2 } });
    await s.close();
    expect(a.structuredContent).toMatchObject({ max_credits: 300, needs_confirmation: true });
    expect(b.structuredContent).toMatchObject({ max_credits: 30, needs_confirmation: false });
  });
});

describe("never auto-paginates", () => {
  it("one tool call is one upstream data call", async () => {
    const s = await session();
    await s.call("search_shipments", { type: "imp", hs_codes: ["940360"], page_size: 2 });
    await s.close();
    expect(pathCalls("shipping-records")).toBe(1);
  });
});
