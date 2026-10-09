import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { setupServer } from "msw/node";
import { DEFAULT_SETTINGS } from "@bold-mcp/core";
import { loadRecordedFixtures } from "../fixtures/load.ts";
import { createPartnerApiMock } from "../msw/handlers.ts";
import { callerFor, connectInMemory, FAKE_KEY, testDeps } from "../helpers/harness.ts";

// Every tool against the live responses in test/fixtures/recorded: the shaping
// must read the live field names (nested countries, `records` paging, teaser
// counts), and the result must satisfy the tool's outputSchema (the MCP client
// validates structuredContent).
const recorded = loadRecordedFixtures();
const mock = createPartnerApiMock(undefined, { fixtures: "recorded" });
const server = setupServer(...mock.handlers);
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => mock.reset());
afterAll(() => server.close());

type Result = { isError?: boolean; content: { text: string }[]; structuredContent?: Record<string, unknown> };
type Row = Record<string, unknown>;
const COUNTRY = /^[A-Z]{2}$/;

async function call(name: string, args: Record<string, unknown>, confirm = false): Promise<Result> {
  const { deps } = testDeps();
  const conn = await connectInMemory(deps, callerFor(FAKE_KEY, { settings: DEFAULT_SETTINGS }));
  try {
    let r = (await conn.client.callTool({ name, arguments: args })) as Result;
    if (confirm && r.structuredContent?.status === "confirmation_required") {
      const token = (r.structuredContent.confirmation as { confirmation_token: string }).confirmation_token;
      r = (await conn.client.callTool({ name, arguments: { ...args, confirmation_token: token } })) as Result;
    }
    expect(r.isError, r.content[0]?.text).toBeFalsy();
    return r;
  } finally {
    await conn.close();
  }
}

const rows = (r: Result) => (r.structuredContent?.rows ?? []) as Row[];
const companyId = (path: string) => String(recorded.get(path as never)?.request.company_id);
const has = (path: string) => recorded.has(path as never);

describe.runIf(recorded.size > 0)("tools against recorded live responses", () => {
  it.runIf(has("company-search-free"))("find_company_id reads the nested country", async () => {
    const r = await call("find_company_id", { type: "imp", company_name: "samsung", page_size: 1 });
    expect(rows(r)[0]?.company_id).toBeTruthy();
    expect(rows(r)[0]?.country).toMatch(COUNTRY);
    expect(r.structuredContent?.total).toBeGreaterThan(0);
  });

  it.runIf(has("insights"))("get_market_insights flattens top-10 countries", async () => {
    const r = await call("get_market_insights", { type: "imp", hs_codes: ["940360"] });
    const top = r.structuredContent?.top_importer_countries as Row[];
    expect(top[0]?.country).toMatch(COUNTRY);
    expect(top[0]?.country_name).toBeTruthy();
    expect(typeof (r.structuredContent?.summary as Row).total_shipments).toBe("number");
  });

  it.runIf(has("search-filters") && has("products") && has("credit-usage") && has("credit-usage-logs"))("free list and account tools return rows", async () => {
    expect((await call("get_filter_options", { type: "imp", hs_codes: ["940360"] })).structuredContent).toBeTruthy();
    expect(rows(await call("search_products", { type: "imp", hs_codes: ["940360"], page_size: 1 }))[0]?.hs_code).toBeTruthy();
    const balance = await call("get_credit_balance", {});
    expect((balance.structuredContent?.data_credits as Row).remaining).toEqual(expect.any(Number));
    const history = rows(await call("get_credit_history", { page_size: 2 }));
    expect(history[0]).toMatchObject({ credit_type: expect.any(String), action: expect.any(String), credits_used: expect.any(Number) });
  });

  it.runIf(has("company-contacts") && has("advanced-company-contacts"))("find_company_contacts keeps only teaser counts", async () => {
    const id = companyId("company-contacts");
    for (const volume of ["lite", "pro"]) {
      const r = await call("find_company_contacts", { type: "imp", company_id: id, page_size: 1, volume });
      const row = rows(r)[0];
      expect(row?.contact_id).toBeTruthy();
      expect(row?.available).toEqual(expect.objectContaining({ professional_emails: expect.any(Number), phones: expect.any(Number) }));
      expect(JSON.stringify(r.structuredContent)).not.toContain("@");
    }
  });

  it.runIf(has("shipping-records"))("search_shipments renames live fields and labels record ids", async () => {
    const row = rows(await call("search_shipments", { type: "imp", hs_codes: ["940360"], page_size: 1 }))[0];
    expect(row).toMatchObject({ shipment_id: expect.any(String), import_country: expect.stringMatching(COUNTRY), export_country: expect.stringMatching(COUNTRY) });
    expect(row?.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(row).not.toHaveProperty("country_imp");
    expect(row).not.toHaveProperty("id");
  });

  it.runIf(has("all-importers") && has("all-exporters"))("list_importers and list_exporters read nested countries and ports", async () => {
    for (const tool of ["list_importers", "list_exporters"]) {
      const row = rows(await call(tool, { hs_codes: ["940360"], page_size: 1 }))[0];
      expect(row?.country, tool).toMatch(COUNTRY);
      expect((row?.countries as string[]).length, tool).toBeGreaterThan(0);
    }
  });

  it.runIf(has("company-search") && has("competitors"))("search_companies and find_competitors read the nested country", async () => {
    expect(rows(await call("search_companies", { type: "imp", company_name: "samsung", page_size: 1 }))[0]?.country).toMatch(COUNTRY);
    expect(rows(await call("find_competitors", { type: "imp", company_id: companyId("competitors"), page_size: 1 }))[0]?.country).toMatch(COUNTRY);
  });

  it.runIf(has("company-details"))("get_company_profile reads countries, ports and classifications", async () => {
    const profile = (await call("get_company_profile", { type: "imp", company_id: companyId("company-details") })).structuredContent?.profile as Row;
    expect(profile.country).toMatch(COUNTRY);
    expect((profile.countries as string[]).length).toBeGreaterThan(0);
    expect((profile.ports as string[]).length).toBeGreaterThan(0);
    expect(Object.keys(profile.totals as Row).length).toBeGreaterThan(0);
  });

  it.runIf(has("contact-look-up"))("reveal_contact_details reads the live email and title fields", async () => {
    const contactId = String(recorded.get("contact-look-up")?.request.contact_id);
    const contact = (await call("reveal_contact_details", { contact_id: contactId, lookup_type: ["professional_emails"] }, true)).structuredContent?.contact as Row;
    expect(contact.position).toBeTruthy();
    expect(contact.company).toBeTruthy();
    expect((contact.professional_emails as Row[])[0]).toMatchObject({ email: expect.stringContaining("@"), verification: expect.any(String) });
  });
});
