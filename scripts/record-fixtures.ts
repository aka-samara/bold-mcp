// Records live staging responses for the 22 global paths into
// test/fixtures/recorded/<path>.json, scrubbed of the API key.
//
//   npm run fixtures:record                     # free paths only (0 credits)
//   npm run fixtures:record -- --paid           # + paid data/contact-list/KYB-search paths
//   npm run fixtures:record -- --paid --unlocks # + contact look-up and the 4 KYB sections
//
// Options: --company "<name>" (default "walmart"), --hs 940360, --type imp|exp,
//          --max-credits N (default 500; aborts before spending more).
//
// Budget rules (from the job brief): page_size 1, each unlock endpoint at most
// once per run, Credit Usage Logs checked at the end.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { ENDPOINTS, getEndpoint, type EndpointPath } from "@bold-mcp/core";
import { liveContext, readBalances } from "./live.ts";

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const opt = (name: string, fallback: string) => {
  const i = argv.indexOf(`--${name}`);
  const value = i >= 0 ? argv[i + 1] : undefined;
  return value ?? fallback;
};

const paid = flag("paid");
const unlocks = flag("unlocks");
const company = opt("company", "walmart");
const hs = opt("hs", "940360");
const type = opt("type", "imp");
const maxCredits = Number(opt("max-credits", "500"));

const UNLOCK_PATHS = new Set<EndpointPath>(["contact-look-up", "advanced-kyb-search", "financial-kyb", "shareholders-kyb", "officers-kyb"]);

const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = join(root, "test/fixtures/recorded");
const synthDir = join(root, "test/fixtures/synthetic");
mkdirSync(outDir, { recursive: true });

const ctx = liveContext();
const ids: { company_id?: string; contact_id?: string; kyb_id?: string } = {};

function firstRow(body: unknown): Record<string, unknown> | undefined {
  const data = (body as { data?: unknown })?.data;
  const rows = Array.isArray(data) ? data : (Object.values((data as Record<string, unknown>) ?? {}).find(Array.isArray) as unknown[] | undefined);
  const row = rows?.[0];
  return row && typeof row === "object" ? (row as Record<string, unknown>) : undefined;
}

function requestFor(path: EndpointPath): Record<string, unknown> | null {
  const page = { page_size: 1, page_no: 1 };
  const byCompany = ids.company_id ? { type, company_id: ids.company_id } : null;
  switch (path) {
    case "search-filters":
    case "shipping-filters":
      return { type, hs_codes: [hs] };
    case "insights":
      return { type, hs_codes: [hs] };
    case "products":
      return { type, hs_codes: [hs], ...page };
    case "shipping-records":
      return { type, hs_codes: [hs], ...page };
    case "all-importers":
    case "all-exporters":
      return { hs_codes: [hs], ...page };
    case "company-search-free":
    case "company-search":
      return { type, company_name: company, ...page };
    case "company-details":
    case "check-logistic-company":
      return byCompany;
    case "competitors":
    case "company-contacts":
    case "advanced-company-contacts":
      return byCompany && { ...byCompany, ...page };
    case "contact-look-up":
      return ids.contact_id ? { contact_id: ids.contact_id, lookup_type: ["professional_emails"] } : null;
    case "kyb-search":
      return byCompany;
    case "advanced-kyb-search":
    case "financial-kyb":
      return ids.kyb_id ? { kyb_id: ids.kyb_id } : null;
    case "shareholders-kyb":
    case "officers-kyb":
      return ids.kyb_id ? { kyb_id: ids.kyb_id, ...page } : null;
    case "credit-usage":
      return {};
    case "credit-usage-logs":
      return { page_size: 2, page_no: 1 };
  }
}

/** Worst-case credits for a page_size 1 request. */
function worstCase(path: EndpointPath): number {
  const ep = getEndpoint(path);
  if (ep.charge === "free") return 0;
  if (path === "contact-look-up") return 10; // professional_emails only
  return ep.unitCredits;
}

// Order matters: ids found early feed later calls.
const ORDER: EndpointPath[] = [
  "credit-usage", "search-filters", "shipping-filters", "insights", "products", "company-search-free",
  "check-logistic-company", "company-contacts", "credit-usage-logs",
  "shipping-records", "all-importers", "all-exporters", "company-search", "company-details", "competitors",
  "advanced-company-contacts", "kyb-search",
  "contact-look-up", "advanced-kyb-search", "financial-kyb", "shareholders-kyb", "officers-kyb",
];
if (ORDER.length !== ENDPOINTS.length) throw new Error("ORDER must list every endpoint");

const before = readBalances((await ctx.post("credit-usage", {})).body);
console.log(`Base URL ${ctx.baseUrl} · key ${ctx.fingerprint}`);
console.log("Balances before:", JSON.stringify(before));

let planned = 0;
const results: { path: string; status: number | string; ms?: number }[] = [];

for (const path of ORDER) {
  const ep = getEndpoint(path);
  if (ep.charge !== "free" && !paid) { results.push({ path, status: "skipped (needs --paid)" }); continue; }
  if (UNLOCK_PATHS.has(path) && !unlocks) { results.push({ path, status: "skipped (needs --unlocks)" }); continue; }
  const body = requestFor(path);
  if (!body) { results.push({ path, status: "skipped (no id to chain from)" }); continue; }
  const cost = worstCase(path);
  if (planned + cost > maxCredits) { results.push({ path, status: `skipped (would exceed --max-credits ${maxCredits})` }); continue; }
  planned += cost;

  const res = await ctx.post(path, body);
  results.push({ path, status: res.status, ms: res.ms });

  const row = firstRow(res.body);
  if (path === "company-search-free" && row?.id) ids.company_id = String(row.id);
  if (path === "company-contacts" && row?.id) ids.contact_id = String(row.id);
  if (path === "kyb-search" && row?.id) ids.kyb_id = String(row.id);

  const synthetic = JSON.parse(readFileSync(join(synthDir, `${path}.json`), "utf8")) as { responses: Record<string, unknown> };
  const fixture = ctx.scrub({
    _meta: { path, synthetic: false, note: `Recorded ${new Date().toISOString().slice(0, 10)} from ${ctx.baseUrl}. The empty response is still synthetic.` },
    request: body,
    responses: { ok: { status: res.status, body: res.body }, empty: synthetic.responses.empty },
  });
  writeFileSync(join(outDir, `${path}.json`), `${JSON.stringify(fixture, null, 2)}\n`);
}

// A free call with a deliberately wrong key records the real 401 shape.
const bad = await ctx.post("credit-usage", {}, { key: "invalid-key-for-fixture-recording-0000" });
writeFileSync(join(outDir, "_errors.json"), `${JSON.stringify(ctx.scrub({ _meta: { synthetic: false }, errors: { "401": { status: bad.status, body: bad.body } } }), null, 2)}\n`);

const after = readBalances((await ctx.post("credit-usage", {})).body);
const logs = await ctx.post("credit-usage-logs", { page_size: 25, page_no: 1 });
console.table(results);
console.log("Balances after:", JSON.stringify(after));
if (before && after) {
  for (const pool of ["data", "contact", "kyb"] as const) {
    console.log(`  ${pool}: spent ${before[pool].remaining - after[pool].remaining} credits`);
  }
}
console.log(`Worst-case planned: ${planned} credits`);
console.log("Recent credit-usage-logs:", JSON.stringify(logs.body, null, 2).slice(0, 4000));
