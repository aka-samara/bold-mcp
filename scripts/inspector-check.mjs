#!/usr/bin/env node
// Protocol checks with the MCP Inspector CLI against the built servers
// (stdio package and HTTP server in header mode), using the local mock API.
// Run after `npm run build`:  node scripts/inspector-check.mjs
import { execFile, spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { startMock } from "./mock-partner-api.mjs";

const run = promisify(execFile);
const root = fileURLToPath(new URL("..", import.meta.url));
const INSPECTOR = "@modelcontextprotocol/inspector@2.9.0";
const FAKE_KEY = "inspector-check-fake-key-000000000000";
const FAKE_KB_TOKEN = "inspector-check-fake-knowledge-token-0000";

const mock = await startMock(0);
const mockOrigin = `http://127.0.0.1:${mock.address().port}`;
const apiBase = `${mockOrigin}/partner-api`;
let failures = 0;

const tmp = mkdtempSync(join(tmpdir(), "inspector-"));
const configPath = join(tmp, "mcp.json");

async function inspector(args) {
  const { stdout } = await run("npx", ["-y", INSPECTOR, "--cli", "--config", configPath, "--server", "bold", "--format", "json", ...args], {
    cwd: root,
    env: { ...process.env, MCP_INSPECTOR_SECRET_STORE: "memory", HOME: tmp },
    timeout: 120_000,
    maxBuffer: 10 * 1024 * 1024,
  });
  const parsed = JSON.parse(stdout);
  if (parsed.error) throw new Error(`Inspector: ${parsed.error.message}`);
  return parsed.result ?? parsed;
}

function check(label, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
}

async function suite(name, server, { expectedTools = 18 } = {}) {
  writeFileSync(configPath, JSON.stringify({ mcpServers: { bold: server } }));
  const tools = await inspector(["--method", "tools/list"]);
  check(`${name}: tools/list`, tools.tools?.length === expectedTools, `${tools.tools?.length} tools`);
  const resources = await inspector(["--method", "resources/list"]);
  check(`${name}: resources/list`, resources.resources?.length === 5, `${resources.resources?.length} resources`);
  const prompts = await inspector(["--method", "prompts/list"]);
  check(`${name}: prompts/list`, prompts.prompts?.length === 6, `${prompts.prompts?.length} prompts`);
  const call = await inspector(["--method", "tools/call", "--tool-name", "get_credit_balance"]);
  check(`${name}: tools/call get_credit_balance`, !call.isError && call.structuredContent?.source === "Bill of Lading Data");
  const outputs = [tools, resources, prompts, call];
  if (expectedTools > 18) {
    const kb = await inspector(["--method", "tools/call", "--tool-name", "search_knowledge", "--tool-arg", "query=data updates"]);
    check(`${name}: tools/call search_knowledge`, !kb.isError && Array.isArray(kb.structuredContent?.source_ids) && kb.structuredContent.source_ids.length > 0);
    outputs.push(kb);
  }
  const text = JSON.stringify(outputs);
  check(`${name}: key absent from output`, !text.includes(FAKE_KEY) && !text.includes(FAKE_KEY.slice(0, 8)));
  check(`${name}: knowledge token absent from output`, !text.includes(FAKE_KB_TOKEN) && !text.includes(FAKE_KB_TOKEN.slice(0, 8)));
}

try {
  await suite("stdio", { command: "node", args: ["packages/stdio/dist/index.js"], env: { BOLD_API_KEY: FAKE_KEY, BOLD_API_BASE_URL: apiBase } });
  await suite(
    "stdio with knowledge",
    { command: "node", args: ["packages/stdio/dist/index.js"], env: { BOLD_API_KEY: FAKE_KEY, BOLD_API_BASE_URL: apiBase, BOLD_KNOWLEDGE_URL: mockOrigin, BOLD_KNOWLEDGE_TOKEN: FAKE_KB_TOKEN } },
    { expectedTools: 30 },
  );

  const http = spawn("node", ["packages/http-server/dist/index.js"], {
    cwd: root,
    env: { ...process.env, PORT: "3999", HOST: "127.0.0.1", BOLD_API_BASE_URL: apiBase, LOG_LEVEL: "warn" },
    stdio: ["ignore", "inherit", "inherit"],
  });
  try {
    for (let i = 0; i < 50; i++) {
      const ok = await fetch("http://127.0.0.1:3999/healthz").then((r) => r.ok).catch(() => false);
      if (ok) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    await suite("http header mode", { type: "streamable-http", url: "http://127.0.0.1:3999/mcp", headers: { Authorization: `Bearer ${FAKE_KEY}` } });
  } finally {
    http.kill("SIGTERM");
  }
} finally {
  mock.close();
  rmSync(tmp, { recursive: true, force: true });
}

if (failures) {
  console.error(`${failures} Inspector check(s) failed`);
  process.exit(1);
}
console.log("All Inspector checks passed");
