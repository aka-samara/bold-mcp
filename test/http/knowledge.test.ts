import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setupServer } from "msw/node";
import { createPartnerApiMock } from "../msw/handlers.ts";
import { createKnowledgeApiMock, FAKE_KB_TOKEN, KB_ENV } from "../msw/knowledge.ts";
import { FAKE_KEY } from "../helpers/harness.ts";
import { startHttp } from "../helpers/http.ts";

const partner = createPartnerApiMock();
const kb = createKnowledgeApiMock();
const msw = setupServer(...partner.handlers, ...kb.handlers);
let h: Awaited<ReturnType<typeof startHttp>>;

beforeAll(async () => {
  msw.listen({ onUnhandledFrame: "bypass" });
  h = await startHttp({ ...KB_ENV, LOG_LEVEL: "trace" });
});
afterAll(async () => {
  await h.stop();
  msw.close();
});

describe("knowledge tools over HTTP (header mode)", () => {
  it("lists 30 tools and answers search_knowledge without leaking the token", async () => {
    const { client } = await h.connect({ authorization: `Bearer ${FAKE_KEY}` });
    const tools = await client.listTools();
    expect(tools.tools).toHaveLength(30);
    const res = (await client.callTool({ name: "search_knowledge", arguments: { query: "updates" } })) as { isError?: boolean; structuredContent?: Record<string, unknown> };
    expect(res.isError).toBeFalsy();
    expect(res.structuredContent?.source_ids).toHaveLength(3);
    await client.close();
    const all = `${JSON.stringify([tools, res])}\n${h.logs.join("\n")}`;
    expect(all).not.toContain(FAKE_KB_TOKEN);
    expect(all).not.toContain(FAKE_KB_TOKEN.slice(0, 8));
    // The user's API key reaches neither the knowledge API nor its request bodies.
    expect(JSON.stringify(kb.calls)).not.toContain(FAKE_KEY);
    expect(kb.calls.every((c) => c.tokenOk && !c.hasApiKey)).toBe(true);
  });
});
