import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { setupServer } from "msw/node";
import { DEFAULT_API_BASE_URL, ENDPOINTS } from "@bold-mcp/core";
import { EnvelopeSchema, loadErrorFixtures, loadFixtures } from "../fixtures/load.ts";
import { createPartnerApiMock, type Scenario } from "../msw/handlers.ts";

const FAKE_KEY = "00000000-test-fake-key-0000000000000";
const mock = createPartnerApiMock();
const server = setupServer(...mock.handlers);

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => mock.reset());
afterAll(() => server.close());

async function call(path: string, body: unknown, key: string | null = FAKE_KEY) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (key) headers["api-key"] = key;
  const res = await fetch(`${DEFAULT_API_BASE_URL}/${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  return { status: res.status, body: EnvelopeSchema.parse(await res.json()) };
}

describe("fixtures", () => {
  const fixtures = loadFixtures();

  it("exist for all 22 global paths", () => {
    expect([...fixtures.keys()].sort()).toEqual(ENDPOINTS.map((e) => e.path).sort());
  });

  it("include ok and empty responses for every path", () => {
    for (const [path, f] of fixtures) {
      expect(f.responses.ok?.status, path).toBe(200);
      expect(f.responses.empty, path).toBeDefined();
    }
  });

  it("include the documented error statuses", () => {
    expect(Object.keys(loadErrorFixtures()).sort()).toEqual(["400", "401", "402", "403", "404", "500"]);
  });

  it("send page_size 1-2 on every paged request (testing budget)", () => {
    for (const [path, f] of fixtures) {
      const size = f.request.page_size;
      if (size !== undefined) expect(Number(size), path).toBeLessThanOrEqual(2);
    }
  });
});

describe("Partner API mock", () => {
  const fixtures = loadFixtures();

  it.each(ENDPOINTS.map((e) => e.path))("serves %s with the envelope", async (path) => {
    const res = await call(path, fixtures.get(path)?.request ?? {});
    expect(res.status).toBe(200);
    expect(res.body.code).toBe(200);
    expect(mock.calls.at(-1)).toMatchObject({ path, hasApiKey: true });
  });

  it("returns 401 without an api-key header", async () => {
    const res = await call("credit-usage", {}, null);
    expect(res.status).toBe(401);
  });

  it.each(["400", "401", "402", "403", "404", "500"] satisfies Scenario[])("serves error scenario %s", async (s) => {
    mock.setScenario("shipping-records", s);
    const res = await call("shipping-records", {});
    expect(res.status).toBe(Number(s));
  });

  it("serves the empty scenario", async () => {
    mock.setScenario("all-importers", "empty");
    const res = await call("all-importers", {});
    expect(res.body.data).toEqual({ total: 0, list: [] });
  });
});
