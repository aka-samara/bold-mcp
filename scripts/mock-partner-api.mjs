#!/usr/bin/env node
// Local stand-in for the Partner API, serving test/fixtures (recorded fixtures
// win over synthetic ones). For local development and the Inspector checks.
//   node scripts/mock-partner-api.mjs [--port 4010]
// Then set BOLD_API_BASE_URL=http://127.0.0.1:4010/partner-api
// Any api-key is accepted except one starting with "bad".

import { createServer } from "node:http";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

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
    req.resume();
    req.on("end", () => send(fx.responses.ok.status, fx.responses.ok.body));
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf("--port");
  const server = await startMock(i > 0 ? Number(process.argv[i + 1]) : 4010);
  console.log(`Mock Partner API on http://127.0.0.1:${server.address().port}/partner-api`);
}
