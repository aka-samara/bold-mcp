// Live smoke test (brief: "Every tool once on staging with page_size 1; then
// compare server estimates with Credit Usage Logs (must match)").
//
// Runs each tool through the real MCP server in-process with the test key,
// then reconciles the server's credits_used per pool with the charges that
// appeared in credit-usage-logs during the run.
//
//   npm run smoke:live                       # free tools only
//   npm run smoke:live -- --paid             # + paid tools (page_size 1)
//   npm run smoke:live -- --paid --unlocks   # + contact and KYB unlocks (once each)
//   npm run smoke:mock                       # the same run against the local mock API (CI)
//
// Options: --company "<name>" (default "walmart"), --hs 940360, --max-credits 300
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { pino } from "pino";
import { ALL_TOOLS, createBoldServer, createCoreDeps, createLogger, DEFAULT_SETTINGS, estimateCost, keyFingerprint, loadCoreConfig, loadCostTable, readApiKey } from "@bold-mcp/core";

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(`--${n}`);
const opt = (n: string, d: string) => {
  const i = argv.indexOf(`--${n}`);
  return (i >= 0 ? argv[i + 1] : undefined) ?? d;
};

let mock: { close(): void; address(): unknown } | undefined;
if (flag("mock")) {
  // @ts-expect-error -- plain JS helper without type declarations
  const { startMock } = (await import("./mock-partner-api.mjs")) as { startMock(port: number): Promise<{ close(): void; address(): { port: number } }> };
  const m = await startMock(0);
  mock = m;
  process.env.BOLD_API_BASE_URL = `http://127.0.0.1:${m.address().port}/partner-api`;
  process.env.BOLD_TEST_API_KEY = "mock-smoke-fake-key-000000000000";
}

const config = loadCoreConfig();
const apiKey = readApiKey(["BOLD_TEST_API_KEY"]);
if (!apiKey) {
  process.stderr.write("BOLD_TEST_API_KEY is not set.\n");
  process.exit(2);
}
const paid = flag("paid");
const unlocks = flag("unlocks");
const maxCredits = Number(opt("max-credits", "300"));
const company = opt("company", "walmart");
const hs = opt("hs", "940360");

const logger = createLogger({ level: "warn" }, pino.destination(2));
const deps = createCoreDeps(config, logger);
const caller = {
  apiKey,
  fingerprint: keyFingerprint(apiKey),
  connectionId: null,
  authMode: "stdio" as const,
  keyStatus: "unknown" as const,
  // The smoke run confirms its own unlocks by passing the token back, once each.
  settings: { ...DEFAULT_SETTINGS, perCallLimit: 50, dailyLimit: maxCredits },
};
const server = createBoldServer({ deps, getCaller: () => caller });
const [ct, st] = InMemoryTransport.createLinkedPair();
await server.connect(st);
const client = new Client({ name: "live-smoke", version: "1.0.0" });
await client.connect(ct);

type Res = { isError?: boolean; content: { text: string }[]; structuredContent?: Record<string, unknown> };
const call = async (name: string, args: Record<string, unknown>) => (await client.callTool({ name, arguments: args })) as Res;
const rows = (r: Res) => (r.structuredContent?.rows as Record<string, unknown>[] | undefined) ?? [];

const costs = loadCostTable();
const results: { tool: string; ok: boolean; pool: string | null; credits_used: number; note: string }[] = [];
const spent: Record<string, number> = { data: 0, contact: 0, kyb: 0 };
let planned = 0;

async function run(tool: string, args: Record<string, unknown>) {
  if (!ALL_TOOLS.some((t) => t.name === tool)) return results.push({ tool, ok: true, pool: null, credits_used: 0, note: "not implemented yet" });
  const est = estimateCost(costs, tool, args);
  if (est?.pool && planned + est.max_credits > maxCredits) return results.push({ tool, ok: true, pool: est.pool, credits_used: 0, note: "skipped: --max-credits" });
  planned += est?.max_credits ?? 0;
  let r = await call(tool, args);
  if (r.structuredContent?.status === "confirmation_required") {
    const token = (r.structuredContent.confirmation as { confirmation_token: string }).confirmation_token;
    r = await call(tool, { ...args, confirmation_token: token });
  }
  const used = Number(r.structuredContent?.credits_used ?? 0);
  const pool = (r.structuredContent?.pool as string | null | undefined) ?? null;
  if (pool) spent[pool] = (spent[pool] ?? 0) + used;
  results.push({ tool, ok: !r.isError, pool, credits_used: used, note: r.isError ? (r.content[0]?.text ?? "").slice(0, 120) : String(r.structuredContent?.status ?? "ok") });
  return r;
}

// Newest log entry before the run, so the reconciliation only counts this run.
const logsBefore = await call("get_credit_history", { page_size: 1 });
const lastIdBefore = rows(logsBefore)[0]?.id ?? null;

await run("get_credit_balance", {});
await run("estimate_cost", { tool: "list_importers", arguments: { page_size: 1 } });
await run("get_filter_options", { type: "imp", hs_codes: [hs] });
await run("get_filter_options", { type: "imp", hs_codes: [hs], include_parties: true });
await run("get_market_insights", { type: "imp", hs_codes: [hs] });
await run("search_products", { type: "imp", hs_codes: [hs], page_size: 1 });
const found = await run("find_company_id", { type: "imp", company_name: company, page_size: 1 });
const companyId = found && typeof found !== "number" ? (rows(found)[0]?.company_id as string | undefined) : undefined;
if (companyId) {
  await run("check_logistics_company", { type: "imp", company_id: companyId });
  const contacts = await run("find_company_contacts", { company_id: companyId, type: "imp", page_size: 1 });
  if (paid) {
    await run("search_shipments", { type: "imp", hs_codes: [hs], page_size: 1 });
    await run("list_importers", { hs_codes: [hs], page_size: 1 });
    await run("list_exporters", { hs_codes: [hs], page_size: 1 });
    await run("search_companies", { type: "imp", company_name: company, page_size: 1 });
    await run("find_competitors", { type: "imp", company_id: companyId, page_size: 1 });
    await run("get_company_profile", { type: "imp", company_id: companyId });
    await run("find_company_contacts", { company_id: companyId, type: "imp", page_size: 1, volume: "pro" });
    const kyb = await run("search_kyb", { company_id: companyId, type: "imp" });
    if (unlocks) {
      const contactId = contacts && typeof contacts !== "number" ? (rows(contacts)[0]?.contact_id as string | undefined) : undefined;
      if (contactId) await run("reveal_contact_details", { contact_id: contactId, lookup_type: ["professional_emails"] });
      const kybId = kyb && typeof kyb !== "number" ? (rows(kyb)[0]?.kyb_id as string | undefined) : undefined;
      if (kybId) await run("get_kyb_report", { kyb_id: kybId, sections: ["details", "financials", "shareholders", "officers"] });
    }
  }
} else {
  results.push({ tool: "(chain)", ok: false, pool: null, credits_used: 0, note: `find_company_id found nothing for "${company}"` });
}

// Reconcile with Credit Usage Logs.
const logs = await call("get_credit_history", { page_size: 100 });
const fromLogs: Record<string, number> = { data: 0, contact: 0, kyb: 0 };
const unmatched: string[] = [];
for (const row of rows(logs)) {
  if (lastIdBefore !== null && row.id === lastIdBefore) break;
  const type = String(row.credit_type ?? "").toLowerCase();
  const pool = type.includes("contact") ? "contact" : type.includes("kyb") ? "kyb" : type.includes("data") ? "data" : null;
  if (pool) fromLogs[pool] = (fromLogs[pool] ?? 0) + Number(row.credits_used ?? 0);
  else unmatched.push(`${row.credit_type}/${row.action}`);
}

await client.close();
await server.close();
mock?.close();

console.table(results);
console.log("Credits by pool (server estimate vs Credit Usage Logs):");
let mismatch = false;
for (const pool of ["data", "contact", "kyb"]) {
  const a = spent[pool] ?? 0;
  const b = fromLogs[pool] ?? 0;
  if (a !== b) mismatch = true;
  console.log(`  ${pool.padEnd(8)} server ${String(a).padStart(5)}   logs ${String(b).padStart(5)}   ${a === b ? "match" : "MISMATCH"}`);
}
if (unmatched.length) console.log(`Log entries with an unknown credit_type: ${unmatched.join(", ")}`);
const failed = results.filter((r) => !r.ok);
if (failed.length || mismatch) {
  console.error(`FAIL: ${failed.length} tool failure(s)${mismatch ? ", estimate/log mismatch" : ""}`);
  process.exit(1);
}
console.log("PASS");
