/* global __ENV, __VU */
// k6 load test (brief: 50 concurrent connections for 10 minutes; p95 server
// overhead under 300 ms). Each virtual user is one MCP connection in header
// mode with its own key and client IP, calling tools at about one a second.
//
// Against the local mock API (overhead = whole request time, the mock answers at once):
//   npm run dev:mock-api &
//   BOLD_API_BASE_URL=http://127.0.0.1:4010/partner-api BOLD_TRUST_PROXY_HOPS=1 npm run start:http &
//   k6 run infra/load/mcp-load.js
// Options (env): MCP_URL (default http://127.0.0.1:3000/mcp), VUS (50), DURATION (10m), KEY_PREFIX.
// Against staging, use test keys only and free tools only (the default mix is free).
import http from "k6/http";
import { check, sleep } from "k6";
import { Trend } from "k6/metrics";

const URL = __ENV.MCP_URL || "http://127.0.0.1:3000/mcp";
const toolLatency = new Trend("mcp_tool_call_ms", true);

export const options = {
  scenarios: {
    connections: { executor: "constant-vus", vus: Number(__ENV.VUS || 50), duration: __ENV.DURATION || "10m" },
  },
  thresholds: {
    mcp_tool_call_ms: ["p(95)<300"],
    http_req_failed: ["rate<0.01"],
    checks: ["rate>0.99"],
  },
};

const CALLS = [
  { name: "get_market_insights", arguments: { type: "imp", hs_codes: ["940360"] } },
  { name: "search_products", arguments: { type: "imp", hs_codes: ["940360"], page_size: 5 } },
  { name: "get_filter_options", arguments: { type: "imp", hs_codes: ["940360"] } },
  { name: "get_credit_balance", arguments: {} },
  { name: "estimate_cost", arguments: { tool: "list_importers", arguments: { page_size: 10 } } },
  { name: "check_logistics_company", arguments: { type: "imp", company_id: "cmp_synthetic_001" } },
];

/** Streamable HTTP answers either JSON or one SSE event; return the JSON-RPC message. */
function rpcBody(res) {
  const ct = res.headers["Content-Type"] || "";
  if (ct.includes("text/event-stream")) {
    const line = (res.body || "").split("\n").find((l) => l.startsWith("data: "));
    return line ? JSON.parse(line.slice(6)) : null;
  }
  return res.body ? JSON.parse(res.body) : null;
}

let session = null;
let id = 0;

function headers() {
  const h = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${__ENV.KEY_PREFIX || "load-test-key"}-${String(__VU).padStart(4, "0")}-xxxxxxxxxxxx`,
    "x-forwarded-for": `198.18.${Math.floor(__VU / 250)}.${__VU % 250}`,
  };
  if (session) {
    h["mcp-session-id"] = session;
    h["mcp-protocol-version"] = "2025-11-25";
  }
  return h;
}

function connect() {
  session = null;
  const init = http.post(URL, JSON.stringify({ jsonrpc: "2.0", id: ++id, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "k6", version: "1" } } }), { headers: headers(), tags: { op: "initialize" } });
  check(init, { "initialize 200": (r) => r.status === 200 });
  session = init.headers["Mcp-Session-Id"] || null;
  http.post(URL, JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }), { headers: headers(), tags: { op: "initialized" } });
}

export default function () {
  if (!session) connect();
  const call = CALLS[Math.floor(Math.random() * CALLS.length)];
  const res = http.post(URL, JSON.stringify({ jsonrpc: "2.0", id: ++id, method: "tools/call", params: call }), { headers: headers(), tags: { op: "tools/call", tool: call.name } });
  if (res.status === 404) {
    session = null; // session expired: reconnect next iteration
    return;
  }
  const body = res.status === 200 ? rpcBody(res) : null;
  check(res, { "tools/call ok": () => res.status === 200 && body && body.result && !body.result.isError });
  toolLatency.add(res.timings.duration, { tool: call.name });
  sleep(0.8 + Math.random() * 0.4);
}
