import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import type { ServerNotification, ServerRequest } from "@modelcontextprotocol/sdk/types.js";
import { estimateCost } from "./billing/estimator.js";
import type { EndpointPath } from "./client/endpoints.js";
import { PartnerApiError, toolErrorMessage } from "./client/errors.js";
import { SERVER_INSTRUCTIONS } from "./instructions.js";
import { CONNECTION_WINDOWS, formatWait, LocalRateLimitError, UPSTREAM_WINDOWS } from "./limits/rate-limit.js";
import type { ToolCallLog } from "./logging.js";
import { registerPrompts } from "./prompts/index.js";
import { registerResources } from "./resources/index.js";
import { ALL_TOOLS } from "./tools/index.js";
import type { CallerContext, CoreDeps, ToolDefinition, ToolRuntime } from "./tools/types.js";

export type Extra = RequestHandlerExtra<ServerRequest, ServerNotification>;

export const SERVER_NAME = "bill-of-lading-data";
export const SERVER_VERSION = "0.1.0";

export interface BoldServerOptions {
  deps: CoreDeps;
  /** Who is calling this request. Throws if the request carries no usable credentials. */
  getCaller(extra: Extra): CallerContext;
  tools?: readonly ToolDefinition[];
}

type ToolCallResult = {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

function errorResult(text: string): ToolCallResult {
  return { content: [{ type: "text", text }], isError: true };
}

function upstreamLimitMessage(path: keyof typeof UPSTREAM_WINDOWS, window: string, retryAfterMs: number): string {
  const wait = formatWait(retryAfterMs);
  if (path === "company-search-free")
    return `The free company search limit for this key is used up for this ${window} (try again in ${wait}). search_companies can do the same search for 15 data credits per company returned; ask the user before using it.`;
  if (path === "company-contacts")
    return `The free contact preview limit for this key is used up for this ${window} (try again in ${wait}). Pro mode (find_company_contacts with volume="pro") costs 2 contact credits per page; ask the user before using it.`;
  return `The Pro contacts limit for this key is used up for this ${window}. Try again in ${wait}.`;
}

/** Build the MCP server with all tools, resources and prompts. One per session. */
export function createBoldServer(opts: BoldServerOptions): McpServer {
  const { deps } = opts;
  const server = new McpServer(
    { name: SERVER_NAME, title: "Bill of Lading Data", version: SERVER_VERSION, websiteUrl: "https://billofladingdata.com" },
    { instructions: SERVER_INSTRUCTIONS, capabilities: { logging: {} } },
  );

  for (const tool of opts.tools ?? ALL_TOOLS) {
    server.registerTool(
      tool.name,
      { title: tool.title, description: tool.description, inputSchema: tool.inputSchema, outputSchema: tool.outputSchema, annotations: tool.annotations },
      async (args: Record<string, unknown>, extra: Extra) => runTool(tool, args, extra),
    );
  }
  registerResources(server, deps.costs);
  registerPrompts(server);
  return server;

  async function runTool(tool: ToolDefinition, args: Record<string, unknown>, extra: Extra): Promise<ToolCallResult> {
    const started = Date.now();
    const caller = opts.getCaller(extra);
    const est = estimateCost(deps.costs, tool.name, args);
    let upstreamCalls = 0;
    const log = (outcome: ToolCallLog["outcome"], errorKind?: string) => {
      const entry: ToolCallLog = {
        tool: tool.name,
        connection_id: caller.connectionId,
        key_fp: caller.fingerprint,
        auth_mode: caller.authMode,
        pool: est?.pool ?? null,
        credits_estimated: est?.max_credits ?? 0,
        latency_ms: Date.now() - started,
        outcome,
        upstream_calls: upstreamCalls,
        ...(errorKind ? { error_kind: errorKind } : {}),
      };
      deps.logger.info({ tool_call: entry }, "tool_call");
    };

    if (caller.keyStatus === "invalid") {
      log("invalid_key");
      return errorResult("API key not recognised — check the key in your client settings.");
    }

    const limiterKey = caller.connectionId ?? caller.fingerprint;
    const perConn = await deps.rateLimits.consume(`conn:${limiterKey}`, CONNECTION_WINDOWS);
    if (!perConn.allowed) {
      log("rate_limited", "connection");
      return errorResult(`Too many tool calls on this connection (limit 60 a minute). Try again in ${formatWait(perConn.retryAfterMs)}.`);
    }
    const release = deps.concurrency.tryAcquire(limiterKey);
    if (!release) {
      log("rate_limited", "concurrency");
      return errorResult("Too many tool calls running at once on this connection (limit 5). Wait for one to finish.");
    }

    const runtime: ToolRuntime = {
      deps,
      caller: { fingerprint: caller.fingerprint, connectionId: caller.connectionId, authMode: caller.authMode, keyStatus: caller.keyStatus, settings: caller.settings },
      signal: extra.signal,
      async call(path: EndpointPath, body: Record<string, unknown>) {
        if (path in UPSTREAM_WINDOWS) {
          const p = path as keyof typeof UPSTREAM_WINDOWS;
          const r = await deps.rateLimits.consume(`up:${caller.fingerprint}:${p}`, UPSTREAM_WINDOWS[p]);
          if (!r.allowed) throw new LocalRateLimitError(p, r.window, r.retryAfterMs);
        }
        upstreamCalls++;
        const res = await deps.client.call(path, body, caller.apiKey, extra.signal);
        return res.data;
      },
    };

    try {
      const out = await tool.handler(args as never, runtime);
      log("ok");
      return { content: [{ type: "text", text: out.summary }], structuredContent: out.structured as Record<string, unknown> };
    } catch (err) {
      if (err instanceof LocalRateLimitError) {
        log("rate_limited", err.scope);
        return errorResult(err.scope in UPSTREAM_WINDOWS ? upstreamLimitMessage(err.scope as keyof typeof UPSTREAM_WINDOWS, err.window, err.retryAfterMs) : err.message);
      }
      if (err instanceof PartnerApiError) {
        if (err.kind === "unauthorized" && caller.onKeyRejected) await caller.onKeyRejected();
        log("tool_error", err.kind);
        return errorResult(toolErrorMessage(err, est?.pool ?? null));
      }
      log("exception", err instanceof Error ? err.name : "unknown");
      deps.logger.error({ tool: tool.name, err_name: err instanceof Error ? err.name : "unknown" }, "tool handler failed");
      return errorResult("Something went wrong on the Bill of Lading Data MCP server. Try again; if it persists, contact support.");
    } finally {
      release();
    }
  }
}

export { LATEST_PROTOCOL_VERSION as LATEST_SUPPORTED_PROTOCOL } from "@modelcontextprotocol/sdk/types.js";
