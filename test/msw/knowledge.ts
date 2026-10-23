import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { http, HttpResponse } from "msw";

/** Fake knowledge token built at runtime; tests assert it never leaks. */
export const FAKE_KB_TOKEN = ["kbt", "5e1d0c9a", "-test-only-knowledge-token-0000000000"].join("");
export const KB_URL = "https://sales.test.example";

const fixtures = JSON.parse(readFileSync(fileURLToPath(new URL("../fixtures/knowledge/tools.json", import.meta.url)), "utf8")) as {
  responses: Record<string, { data: unknown; source_ids: string[]; notes: string[] }>;
};
export const KNOWLEDGE_FIXTURES = fixtures.responses;

/** Environment that switches the knowledge tools on, pointed at this mock. */
export const KB_ENV = { BOLD_KNOWLEDGE_URL: KB_URL, BOLD_KNOWLEDGE_TOKEN: FAKE_KB_TOKEN };

export interface KnowledgeApiMock {
  handlers: ReturnType<typeof http.post>[];
  /** Serve this exact response for one tool until reset. */
  setResponse(tool: string, status: number, body: unknown, headers?: Record<string, string>): void;
  /** Requests seen, with the Authorization header reduced to a check against the expected token. */
  calls: { tool: string; body: unknown; tokenOk: boolean; hasApiKey: boolean }[];
  reset(): void;
}

/** msw handlers for the sales assistant's knowledge API (`POST /api/kb/v1/tools/{name}`). */
export function createKnowledgeApiMock(baseUrl: string = KB_URL, token: string = FAKE_KB_TOKEN): KnowledgeApiMock {
  const overrides = new Map<string, { status: number; body: unknown; headers?: Record<string, string> }>();
  const calls: KnowledgeApiMock["calls"] = [];
  const handlers = [
    http.post(`${baseUrl}/api/kb/v1/tools/:name`, async ({ request, params }) => {
      const tool = String(params.name);
      const body: unknown = await request.json().catch(() => null);
      const tokenOk = request.headers.get("authorization") === `Bearer ${token}`;
      calls.push({ tool, body, tokenOk, hasApiKey: request.headers.has("api-key") });
      if (!tokenOk) return HttpResponse.json({ error: "Unauthorized" }, { status: 401 });
      const override = overrides.get(tool);
      if (override) return HttpResponse.json(override.body as never, { status: override.status, ...(override.headers ? { headers: override.headers } : {}) });
      const fixture = KNOWLEDGE_FIXTURES[tool];
      if (!fixture) return HttpResponse.json({ error: `Unknown tool: ${tool}` }, { status: 404 });
      return HttpResponse.json(fixture);
    }),
  ];
  return {
    handlers,
    calls,
    setResponse: (tool, status, body, headers) => void overrides.set(tool, { status, body, ...(headers ? { headers } : {}) }),
    reset() {
      overrides.clear();
      calls.length = 0;
    },
  };
}
