import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { setupServer } from "msw/node";
import { ALL_TOOLS, KNOWLEDGE_SOURCE, KNOWLEDGE_TOOL_NAMES, KNOWLEDGE_TOOLS, TOOL_NAMES } from "@bold-mcp/core";
import { createPartnerApiMock } from "../msw/handlers.ts";
import { createKnowledgeApiMock, FAKE_KB_TOKEN, KB_ENV, KNOWLEDGE_FIXTURES } from "../msw/knowledge.ts";
import { callerFor, connectInMemory, FAKE_KEY, testDeps } from "../helpers/harness.ts";
import { KNOWLEDGE_SAMPLE_ARGS } from "../helpers/samples.ts";

const partner = createPartnerApiMock();
const kb = createKnowledgeApiMock();
const server = setupServer(...partner.handlers, ...kb.handlers);
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => {
  partner.reset();
  kb.reset();
});
afterAll(() => server.close());

type CallResult = { isError?: boolean; content: { type: string; text?: string }[]; structuredContent?: Record<string, unknown> };

async function connect(env: NodeJS.ProcessEnv = KB_ENV) {
  const { deps, logs } = testDeps(env);
  const conn = await connectInMemory(deps, callerFor(FAKE_KEY));
  return { ...conn, logs };
}

async function run(tool: string, args: Record<string, unknown>) {
  const conn = await connect();
  try {
    const res = (await conn.client.callTool({ name: tool, arguments: args })) as CallResult;
    return { res, logs: conn.logs, text: res.content.map((c) => c.text ?? "").join("\n") };
  } finally {
    await conn.close();
  }
}

describe("knowledge tools", () => {
  it("are 12 tools with sample args and fixtures, none clashing with the API tools", () => {
    expect(KNOWLEDGE_TOOLS.map((t) => t.name)).toEqual([...KNOWLEDGE_TOOL_NAMES]);
    expect(Object.keys(KNOWLEDGE_SAMPLE_ARGS).sort()).toEqual([...KNOWLEDGE_TOOL_NAMES].sort());
    expect(Object.keys(KNOWLEDGE_FIXTURES).sort()).toEqual([...KNOWLEDGE_TOOL_NAMES].sort());
    for (const name of KNOWLEDGE_TOOL_NAMES) expect(TOOL_NAMES as readonly string[]).not.toContain(name);
  });

  it("have static descriptions under 1,000 characters that start with the cost", () => {
    for (const t of KNOWLEDGE_TOOLS) {
      expect(t.description.length, t.name).toBeLessThan(1000);
      expect(t.description.split("\n")[0], t.name).toBe("Free, 0 credits (Bill of Lading Data knowledge base).");
      expect(t.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
      expect(t.paid, t.name).toBeFalsy();
    }
  });

  it("are not registered unless the knowledge API is configured", async () => {
    const off = await connect({});
    const on = await connect();
    try {
      const offTools = (await off.client.listTools()).tools.map((t) => t.name);
      const onTools = (await on.client.listTools()).tools.map((t) => t.name);
      expect(offTools.sort()).toEqual(ALL_TOOLS.map((t) => t.name).sort());
      expect(onTools).toHaveLength(30);
      expect(onTools).toEqual(expect.arrayContaining([...KNOWLEDGE_TOOL_NAMES]));
      expect(off.client.getInstructions()).not.toContain("search_knowledge");
      expect(on.client.getInstructions()).toContain("search_knowledge");
    } finally {
      await off.close();
      await on.close();
    }
  });

  it.each(Object.entries(KNOWLEDGE_SAMPLE_ARGS))("%s passes the answer through, also as JSON text", async (tool, args) => {
    const { res } = await run(tool, args);
    expect(res.isError, JSON.stringify(res.content)).toBeFalsy();
    const fixture = KNOWLEDGE_FIXTURES[tool];
    expect(res.structuredContent).toEqual({ source: KNOWLEDGE_SOURCE, ...fixture });
    expect(res.content[0]?.text).toMatch(/answer from \d+ knowledge base entr/);
    expect(JSON.parse(res.content[1]?.text ?? "null")).toEqual(res.structuredContent);
    expect(kb.calls.at(-1)).toMatchObject({ tool, body: args, tokenOk: true });
    expect(partner.calls).toHaveLength(0);
  });

  it("keeps free text from the knowledge base out of the summary", async () => {
    const { res } = await run("search_knowledge", { query: "updates" });
    expect(res.content[0]?.text).toBe("Search the knowledge base: answer from 3 knowledge base entries, with 1 note.");
  });

  it("drops arguments the tool doesn't take before calling the API", async () => {
    await run("get_coverage", { countries: ["VN"], extra: "x" });
    expect(kb.calls.at(-1)?.body).toEqual({ countries: ["VN"] });
  });

  it("rejects invalid input before calling the API", async () => {
    const { res } = await run("search_knowledge", { query: "x" });
    expect(res.isError).toBe(true);
    expect(kb.calls).toHaveLength(0);
  });

  it("logs the call as free, with no pool and no arguments", async () => {
    const { logs } = await run("price_quote", { format: "api", global_records: 100 });
    const entry = logs.map((l) => JSON.parse(l) as { tool_call?: Record<string, unknown> }).find((l) => l.tool_call)?.tool_call;
    expect(entry).toMatchObject({ tool: "price_quote", pool: null, credits_estimated: 0, outcome: "ok", upstream_calls: 1 });
    expect(JSON.stringify(logs)).not.toContain("global_records");
  });

  it.each([
    [400, { error: "Invalid input for get_schema: country is required" }, "rejected the request: Invalid input for get_schema"],
    [401, { error: "Unauthorized" }, "check BOLD_KNOWLEDGE_TOKEN"],
    [404, { error: "Not found" }, "switched off"],
    [500, { error: "boom" }, "unavailable right now"],
    [200, { unexpected: true }, "could not read"],
  ])("maps HTTP %s to a clear tool error", async (status, body, expected) => {
    kb.setResponse("get_schema", status, body);
    const { res, text } = await run("get_schema", { country: "VN", direction: "import" });
    expect(res.isError).toBe(true);
    expect(text).toContain(expected);
  });

  it("retries a 500 at most twice", async () => {
    kb.setResponse("get_terms", 500, { error: "boom" });
    await run("get_terms", {});
    expect(kb.calls).toHaveLength(3);
  });

  it("waits out a short Retry-After and reports a long one", async () => {
    kb.setResponse("get_terms", 429, { error: "Too many requests" }, { "retry-after": "1" });
    await run("get_terms", {});
    expect(kb.calls).toHaveLength(3);
    kb.reset();
    kb.setResponse("get_terms", 429, { error: "Too many requests" }, { "retry-after": "60" });
    const { text } = await run("get_terms", {});
    expect(text).toContain("busy");
    expect(text).toContain("60 seconds");
    expect(kb.calls).toHaveLength(1);
  });

  it("never puts the knowledge token in results, errors or logs", async () => {
    const seen: string[] = [];
    const conn = await connect();
    try {
      for (const [tool, args] of Object.entries(KNOWLEDGE_SAMPLE_ARGS)) seen.push(JSON.stringify(await conn.client.callTool({ name: tool, arguments: args })));
      kb.setResponse("get_terms", 400, { error: `bad token ${FAKE_KB_TOKEN}` });
      seen.push(JSON.stringify(await conn.client.callTool({ name: "get_terms", arguments: {} })));
      for (const status of [401, 404, 429, 500]) {
        kb.setResponse("get_terms", status, { error: "x" });
        seen.push(JSON.stringify(await conn.client.callTool({ name: "get_terms", arguments: {} })));
      }
      seen.push(JSON.stringify(await conn.client.listTools()), conn.client.getInstructions() ?? "");
    } finally {
      await conn.close();
    }
    const all = `${seen.join("\n")}\n${conn.logs.join("\n")}`;
    expect(all).not.toContain(FAKE_KB_TOKEN);
    expect(all).not.toContain(FAKE_KB_TOKEN.slice(0, 8));
    expect(all).toContain("[redacted]");
  });
});
