#!/usr/bin/env node
// Local stand-in for the Partner API, serving test/fixtures (recorded fixtures
// win over synthetic ones). For local development and the Inspector checks.
//   node scripts/mock-partner-api.mjs [--port 4010]
// Then set BOLD_API_BASE_URL=http://127.0.0.1:4010/partner-api
// Any api-key is accepted except one starting with "bad". Paid calls are
// charged like the real API (per record/page/request, only when data is
// returned) and appear in credit-usage and credit-usage-logs. Needs `npm run build`.

import { createServer } from "node:http";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { CONTACT_LOOKUP_PRICES, ENDPOINTS } from "@bold-mcp/core";

const SPEC = new Map(ENDPOINTS.map((e) => [e.path, e]));

function rowCount(data) {
  if (Array.isArray(data)) return data.length;
  if (data && typeof data === "object") {
    const arr = Object.values(data).find(Array.isArray);
    return arr ? arr.length : Object.keys(data).length > 0 ? 1 : 0;
  }
  return 0;
}

/** Credits the real API would charge for this response. */
function charge(spec, request, data) {
  const n = rowCount(data);
  if (spec.charge === "free" || n === 0) return 0;
  if (spec.charge === "per_record") return spec.path === "company-details" ? spec.unitCredits : n * spec.unitCredits;
  if (spec.charge === "per_page" || spec.charge === "per_request") return spec.unitCredits;
  if (spec.charge === "per_person_lookup") {
    return (request.lookup_type ?? []).filter((t) => Array.isArray(data[t]) && data[t].length > 0).reduce((s, t) => s + (CONTACT_LOOKUP_PRICES[t] ?? 0), 0);
  }
  return 0;
}

const root = fileURLToPath(new URL("../test/fixtures/", import.meta.url));

export function loadFixtureMap() {
  const map = new Map();
  for (const dir of ["synthetic", "recorded"]) {
    const d = join(root, dir);
    if (!existsSync(d)) continue;
    for (const f of readdirSync(d)) {
      if (!f.endsWith(".json") || f.startsWith("_")) continue;
      const fx = JSON.parse(readFileSync(join(d, f), "utf8"));
      map.set(fx._meta.path, fx);
    }
  }
  return map;
}

export function startMock(port = 0) {
  const fixtures = loadFixtureMap();
  const charges = [];
  let seq = 0;
  const server = createServer((req, res) => {
    const send = (status, body) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const m = /^\/partner-api\/([a-z-]+)$/.exec(req.url ?? "");
    if (req.method !== "POST" || !m) return send(404, { code: 404, message: "Not found", data: null });
    const key = req.headers["api-key"];
    if (!key || String(key).startsWith("bad")) return send(401, { code: 401, message: "Invalid API key", data: null });
    const fx = fixtures.get(m[1]);
    if (!fx) return send(404, { code: 404, message: "Not found", data: null });
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      let request;
      try {
        request = JSON.parse(raw || "{}");
      } catch {
        return send(400, { code: 400, message: "Invalid JSON", data: null });
      }
      const body = structuredClone(fx.responses.ok.body);
      if (m[1] === "credit-usage") {
        for (const c of charges) {
          const p = body.data.credits[c.credit_type];
          p.used += c.credits_used;
          p.remaining -= c.credits_used;
        }
      }
      if (m[1] === "credit-usage-logs") {
        const synthetic = Array.isArray(body.data?.list) ? body.data.list : [];
        const list = [...charges].reverse().concat(synthetic);
        body.data = { total: list.length, list: list.slice(0, request.page_size ?? 250) };
      }
      const spec = SPEC.get(m[1]);
      const credits = spec ? charge(spec, request, body.data) : 0;
      if (credits > 0) charges.push({ id: `mock_${++seq}`, credit_type: `${spec.pool}_credits`, action: m[1], credits_used: credits, created_at: new Date().toISOString().replace("T", " ").slice(0, 19) });
      send(fx.responses.ok.status, body);
    });
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf("--port");
  const server = await startMock(i > 0 ? Number(process.argv[i + 1]) : 4010);
  console.log(`Mock Partner API on http://127.0.0.1:${server.address().port}/partner-api`);
}
