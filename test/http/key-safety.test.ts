import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupServer } from "msw/node";
import { createPartnerApiMock, type Scenario } from "../msw/handlers.ts";
import { BAD_KEY, FAKE_KEY } from "../helpers/harness.ts";
import { INIT_BODY, startHttp } from "../helpers/http.ts";
import { PAID_SAMPLE_ARGS, SAMPLE_ARGS } from "../helpers/samples.ts";

const mock = createPartnerApiMock(undefined, { invalidKeys: [BAD_KEY] });
const msw = setupServer(...mock.handlers);
let h: Awaited<ReturnType<typeof startHttp>>;

beforeAll(async () => {
  msw.listen({ onUnhandledFrame: "bypass" });
  h = await startHttp({ LOG_LEVEL: "trace" });
});
afterAll(async () => {
  await h.stop();
  msw.close();
});

const SECRETS = [FAKE_KEY, FAKE_KEY.slice(0, 8), BAD_KEY, BAD_KEY.slice(0, 8)];

function assertClean(label: string, text: string) {
  for (const s of SECRETS) expect(text.includes(s), `${label} contains a key`).toBe(false);
}

describe("key safety", () => {
  it("no key appears in logs, tool results or error responses after every tool and error path", async () => {
    const seen: string[] = [];
    for (const key of [FAKE_KEY, BAD_KEY]) {
      const { client } = await h.connect({ authorization: `Bearer ${key}` });
      for (const [tool, args] of Object.entries({ ...SAMPLE_ARGS, ...PAID_SAMPLE_ARGS })) seen.push(JSON.stringify(await client.callTool({ name: tool, arguments: args })));
      // Confirmation path (token issued, then used).
      const confirm = (await client.callTool({ name: "list_importers", arguments: { hs_codes: ["940360"], page_size: 20 } })) as { structuredContent?: { confirmation?: { confirmation_token: string } } };
      seen.push(JSON.stringify(confirm));
      const token = confirm.structuredContent?.confirmation?.confirmation_token;
      if (token) seen.push(JSON.stringify(await client.callTool({ name: "list_importers", arguments: { hs_codes: ["940360"], page_size: 20, confirmation_token: token } })));
      for (const scenario of ["400", "401", "402", "403", "404", "500", "empty"] satisfies Scenario[]) {
        mock.setScenario("insights", scenario);
        seen.push(JSON.stringify(await client.callTool({ name: "get_market_insights", arguments: { type: "imp", hs_codes: ["940360"] } })));
      }
      mock.reset();
      seen.push(JSON.stringify(await client.listTools()), JSON.stringify(await client.listResources()), JSON.stringify(await client.listPrompts()));
      await client.close();
    }

    // Raw HTTP error paths.
    for (const [path, headers] of [
      [`/mcp?apikey=${FAKE_KEY}`, { authorization: `Bearer ${FAKE_KEY}` }],
      ["/mcp", { authorization: `Basic ${FAKE_KEY}` }],
      ["/mcp", { authorization: `Bearer ${FAKE_KEY}`, origin: "https://evil.example" }],
      ["/mcp", { authorization: `Bearer ${FAKE_KEY}`, "mcp-session-id": "x" }],
    ] as const) {
      const res = await fetch(`${h.url}${path}`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers }, body: JSON.stringify(INIT_BODY) });
      seen.push(`${res.status} ${JSON.stringify([...res.headers])} ${await res.text()}`);
    }

    expect(h.logs.length).toBeGreaterThan(10);
    assertClean("logs", h.logs.join("\n"));
    assertClean("responses", seen.join("\n"));
    // Requests to the Partner API carry the key only in the header.
    assertClean("upstream bodies", JSON.stringify(mock.calls.map((c) => c.body)));
  });

  it("logs every tool call with fingerprint, pool, estimate, latency and outcome", () => {
    const toolLogs = h.logs.map((l) => JSON.parse(l) as { tool_call?: Record<string, unknown> }).filter((l) => l.tool_call);
    expect(toolLogs.length).toBeGreaterThan(0);
    for (const l of toolLogs) {
      expect(Object.keys(l.tool_call ?? {})).toEqual(expect.arrayContaining(["tool", "connection_id", "key_fp", "pool", "credits_estimated", "latency_ms", "outcome"]));
      expect(String(l.tool_call?.key_fp)).toMatch(/^[0-9a-f]{12}$/);
    }
  });
});
