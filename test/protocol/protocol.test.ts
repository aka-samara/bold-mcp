import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupServer } from "msw/node";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ALL_TOOLS, createBoldServer, LATEST_SUPPORTED_PROTOCOL } from "@bold-mcp/core";
import { createPartnerApiMock } from "../msw/handlers.ts";
import { callerFor, connectInMemory, FAKE_KEY, testDeps } from "../helpers/harness.ts";

const mock = createPartnerApiMock();
const server = setupServer(...mock.handlers);
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterAll(() => server.close());

describe("initialize", () => {
  it("returns server info and instructions", async () => {
    const { deps } = testDeps();
    const c = await connectInMemory(deps, callerFor(FAKE_KEY));
    expect(c.client.getServerVersion()).toMatchObject({ name: "bill-of-lading-data", title: "Bill of Lading Data" });
    const instructions = c.client.getInstructions() ?? "";
    for (const t of ["get_market_insights", "get_filter_options", "search_products", "find_company_id", "confirmation_required", "Bill of Lading Data"]) {
      expect(instructions).toContain(t);
    }
    expect(c.client.getServerCapabilities()).toMatchObject({ tools: {}, resources: {}, prompts: {} });
    await c.close();
  });

  it.each(["2025-11-25", "2025-06-18", "2025-03-26"])("negotiates protocol version %s", async (version) => {
    const { deps } = testDeps();
    const srv = createBoldServer({ deps, getCaller: () => callerFor(FAKE_KEY) });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await srv.connect(st);
    await ct.start();
    const reply = new Promise<Record<string, unknown>>((resolve) => {
      ct.onmessage = (m) => resolve(m as Record<string, unknown>);
    });
    await ct.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: version, capabilities: {}, clientInfo: { name: "t", version: "1" } } });
    const r = (await reply) as { result: { protocolVersion: string } };
    expect(r.result.protocolVersion).toBe(version);
    await srv.close();
  });

  it("answers an unknown future version with the latest it supports", () => {
    expect(LATEST_SUPPORTED_PROTOCOL).toBe("2025-11-25");
  });
});

describe("tools/list", () => {
  it("lists every implemented tool with schemas, annotations and description rules", async () => {
    const { deps } = testDeps();
    const c = await connectInMemory(deps, callerFor(FAKE_KEY));
    const { tools } = await c.client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(ALL_TOOLS.map((t) => t.name).sort());
    for (const t of tools) {
      const def = ALL_TOOLS.find((d) => d.name === t.name);
      expect(t.name).toMatch(/^[a-z]+(_[a-z]+)*$/);
      expect(t.inputSchema.type).toBe("object");
      expect(t.outputSchema?.type).toBe("object");
      expect(t.description?.length ?? 0, t.name).toBeLessThan(1000);
      expect(t.description?.split("\n")[0], t.name).toMatch(/^(Free|Costs)/);
      expect(t.annotations, t.name).toMatchObject({ readOnlyHint: true, destructiveHint: false, openWorldHint: true });
      if (def?.paid && !["find_company_contacts"].includes(t.name)) {
        expect(t.inputSchema.properties, t.name).toHaveProperty("max_credits");
        expect(t.inputSchema.properties, t.name).toHaveProperty("confirmation_token");
        expect(t.outputSchema?.properties, t.name).toHaveProperty("credits_remaining");
      } else if (t.name !== "find_company_contacts") {
        expect(t.annotations?.idempotentHint, t.name).toBe(true);
      }
    }
    const sc = tools.find((t) => t.name === "search_companies");
    expect(sc?.description).toContain("Use find_company_id (free) if you only need the id.");
    await c.close();
  });

  it("calls a tool end to end", async () => {
    const { deps } = testDeps();
    const c = await connectInMemory(deps, callerFor(FAKE_KEY));
    const r = await c.client.callTool({ name: "get_credit_balance", arguments: {} });
    expect(r.isError).toBeFalsy();
    await c.close();
  });
});

describe("resources", () => {
  it("lists and reads the five resources", async () => {
    const { deps } = testDeps();
    const c = await connectInMemory(deps, callerFor(FAKE_KEY));
    const { resources } = await c.client.listResources();
    expect(resources.map((r) => r.uri).sort()).toEqual(
      ["bold://guide/workflows", "bold://pricing", "bold://reference/contact-roles", "bold://reference/countries", "bold://reference/transport-types"].sort(),
    );
    const pricing = await c.client.readResource({ uri: "bold://pricing" });
    const text = (pricing.contents[0] as { text: string }).text;
    expect(text).toContain("list_importers: 15 data credits per record");
    expect(text).toContain("get_kyb_report: 10 kyb credits per section");
    const countries = JSON.parse(((await c.client.readResource({ uri: "bold://reference/countries" })).contents[0] as { text: string }).text) as { code: string }[];
    expect(countries).toHaveLength(249);
    expect(countries.find((x) => x.code === "US")).toEqual({ code: "US", name: "United States" });
    await c.close();
  });
});

describe("prompts", () => {
  it("lists the six prompts and renders one", async () => {
    const { deps } = testDeps();
    const c = await connectInMemory(deps, callerFor(FAKE_KEY));
    const { prompts } = await c.client.listPrompts();
    expect(prompts.map((p) => p.name).sort()).toEqual(["competitor_scan", "find_buyers", "find_suppliers", "market_size", "my_usage", "supplier_due_diligence"]);
    const p = await c.client.getPrompt({ name: "find_buyers", arguments: { product: "wooden chairs", country: "US" } });
    const text = (p.messages[0]?.content as { text: string }).text;
    expect(text).toMatch(/get_market_insights[\s\S]*list_importers[\s\S]*check_logistics_company[\s\S]*find_company_contacts/);
    await c.close();
  });
});
