import { http, HttpResponse } from "msw";
import { DEFAULT_API_BASE_URL, ENDPOINTS, type EndpointPath } from "@bold-mcp/core";
import { loadErrorFixtures, loadFixtures } from "../fixtures/load.ts";

export type Scenario = "ok" | "empty" | "400" | "401" | "402" | "403" | "404" | "500";

export interface PartnerApiMock {
  handlers: ReturnType<typeof http.post>[];
  /** Serve this scenario for one path until reset. */
  setScenario(path: EndpointPath, scenario: Scenario): void;
  /** Serve this exact response for one path until reset. */
  setResponse(path: EndpointPath, status: number, body: unknown): void;
  /** Requests seen, with the api-key header reduced to a presence flag. */
  calls: { path: string; body: unknown; hasApiKey: boolean }[];
  reset(): void;
}

/** msw handlers serving fixtures for all 22 global paths. */
export function createPartnerApiMock(baseUrl: string = DEFAULT_API_BASE_URL, opts: { invalidKeys?: string[] } = {}): PartnerApiMock {
  const fixtures = loadFixtures();
  const errors = loadErrorFixtures();
  const scenarios = new Map<string, Scenario>();
  const overrides = new Map<string, { status: number; body: unknown }>();
  const calls: PartnerApiMock["calls"] = [];

  const handlers = ENDPOINTS.map((ep) =>
    http.post(`${baseUrl}/${ep.path}`, async ({ request }) => {
      const body: unknown = await request.json().catch(() => null);
      calls.push({ path: ep.path, body, hasApiKey: Boolean(request.headers.get("api-key")) });
      const key = request.headers.get("api-key");
      if (!key || opts.invalidKeys?.includes(key)) {
        const e = errors["401"];
        return HttpResponse.json(e?.body ?? null, { status: 401 });
      }
      const override = overrides.get(ep.path);
      if (override) return HttpResponse.json(override.body as never, { status: override.status });
      const scenario = scenarios.get(ep.path) ?? "ok";
      const fixture = fixtures.get(ep.path);
      const response = /^\d+$/.test(scenario) ? errors[scenario] : fixture?.responses[scenario];
      if (!response) return HttpResponse.json({ code: 500, message: `no fixture for ${ep.path}/${scenario}`, data: null }, { status: 500 });
      return HttpResponse.json(response.body, { status: response.status });
    }),
  );

  return {
    handlers,
    calls,
    setScenario: (path, scenario) => void scenarios.set(path, scenario),
    setResponse: (path, status, body) => void overrides.set(path, { status, body }),
    reset() {
      scenarios.clear();
      overrides.clear();
      calls.length = 0;
    },
  };
}
