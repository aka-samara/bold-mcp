import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { RequestHandlerExtra } from "@modelcontextprotocol/sdk/shared/protocol.js";
import { ElicitResultSchema, type ServerNotification, type ServerRequest } from "@modelcontextprotocol/sdk/types.js";
import { creditsUsed, type BillingOutcome } from "./billing/actual.js";
import { BALANCE_TTL_MS } from "./billing/balance-cache.js";
import { POOL_LABEL } from "./billing/costs.js";
import { utcDay } from "./billing/daily-spend.js";
import { costKeyFor, estimateCost, nextPageCost, type Estimate } from "./billing/estimator.js";
import { decide } from "./billing/guard.js";
import type { CreditPool, EndpointPath } from "./client/endpoints.js";
import { PartnerApiError, toolErrorMessage } from "./client/errors.js";
import { SERVER_INSTRUCTIONS } from "./instructions.js";
import { CONNECTION_WINDOWS, formatWait, LocalRateLimitError, UPSTREAM_WINDOWS } from "./limits/rate-limit.js";
import type { ToolCallLog } from "./logging.js";
import { registerPrompts } from "./prompts/index.js";
import { registerResources } from "./resources/index.js";
import { parseCreditUsage, type Balances } from "./shaping/credits.js";
import { SOURCE } from "./schemas/common.js";
import { ALL_TOOLS } from "./tools/index.js";
import type { CallerContext, CoreDeps, ToolDefinition, ToolRuntime } from "./tools/types.js";

export { LATEST_PROTOCOL_VERSION as LATEST_SUPPORTED_PROTOCOL } from "@modelcontextprotocol/sdk/types.js";

export type Extra = RequestHandlerExtra<ServerRequest, ServerNotification>;

export const SERVER_NAME = "bill-of-lading-data";
export const SERVER_VERSION = "0.2.0";

/** How long to wait for the user to answer an elicitation. */
const ELICIT_TIMEOUT_MS = 5 * 60_000;

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

const fmt = (n: number) => n.toLocaleString("en-US");

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
    const binding = caller.connectionId ?? caller.fingerprint;
    const est = estimateCost(deps.costs, tool.name, args);
    const paidCall = Boolean(tool.paid && est?.pool);
    let upstreamCalls = 0;
    let charged = 0;
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
        ...(paidCall ? { credits_used: charged } : {}),
        ...(errorKind ? { error_kind: errorKind } : {}),
      };
      deps.logger.info({ tool_call: entry }, "tool_call");
    };

    if (caller.keyStatus === "invalid") {
      log("invalid_key");
      return errorResult("API key not recognised — check the key in your client settings.");
    }

    const perConn = await deps.rateLimits.consume(`conn:${binding}`, CONNECTION_WINDOWS);
    if (!perConn.allowed) {
      log("rate_limited", "connection");
      return errorResult(`Too many tool calls on this connection (limit 60 a minute). Try again in ${formatWait(perConn.retryAfterMs)}.`);
    }
    const release = deps.concurrency.tryAcquire(binding);
    if (!release) {
      log("rate_limited", "concurrency");
      return errorResult("Too many tool calls running at once on this connection (limit 5). Wait for one to finish.");
    }

    const call = async (path: EndpointPath, body: Record<string, unknown>) => {
      if (path in UPSTREAM_WINDOWS) {
        const p = path as keyof typeof UPSTREAM_WINDOWS;
        const r = await deps.rateLimits.consume(`up:${caller.fingerprint}:${p}`, UPSTREAM_WINDOWS[p]);
        if (!r.allowed) throw new LocalRateLimitError(p, r.window, r.retryAfterMs);
      }
      upstreamCalls++;
      return (await deps.client.call(path, body, caller.apiKey, extra.signal)).data;
    };

    const balances = async (o: { fresh?: boolean } = {}): Promise<Balances> => {
      if (!o.fresh) {
        const cached = await deps.balances.get(caller.fingerprint);
        if (cached) return cached;
      }
      const fresh = parseCreditUsage(await call("credit-usage", {})).balances;
      await deps.balances.set(caller.fingerprint, fresh, BALANCE_TTL_MS);
      return fresh;
    };

    const runtime: ToolRuntime = {
      deps,
      caller: { fingerprint: caller.fingerprint, connectionId: caller.connectionId, authMode: caller.authMode, keyStatus: caller.keyStatus, settings: caller.settings },
      signal: extra.signal,
      call,
      balances,
    };

    try {
      if (paidCall && est?.pool) {
        const gate = await guard(tool, args, est as Estimate & { pool: CreditPool }, caller, binding, balances, extra);
        if (gate) {
          log(gate.outcome);
          return gate.result;
        }
      }

      const out = await tool.handler(args as never, runtime);
      let structured = out.structured as Record<string, unknown>;
      let summary = out.summary;

      if (tool.paid) {
        const credits = await settle(tool, args, out.billing, binding, balances);
        charged = credits.credits_used;
        structured = { ...structured, ...credits };
        if (credits.pool) {
          const label = POOL_LABEL[credits.pool];
          summary += ` Credits used: ${fmt(credits.credits_used)} ${label} (estimated); ${credits.credits_remaining === null ? "remaining balance unknown" : `${fmt(credits.credits_remaining)} ${label} credits remaining`}.`;
        }
      }
      log("ok");
      return { content: [{ type: "text", text: summary }], structuredContent: structured };
    } catch (err) {
      if (err instanceof LocalRateLimitError) {
        log("rate_limited", err.scope);
        return errorResult(err.scope in UPSTREAM_WINDOWS ? upstreamLimitMessage(err.scope as keyof typeof UPSTREAM_WINDOWS, err.window, err.retryAfterMs) : err.message);
      }
      if (err instanceof PartnerApiError) {
        if (err.kind === "unauthorized" && caller.onKeyRejected) await caller.onKeyRejected();
        if (err.kind === "payment_required" && est?.pool) await deps.balances.delete(caller.fingerprint);
        log("tool_error", err.kind);
        let message = toolErrorMessage(err, est?.pool ? POOL_LABEL[est.pool] : null);
        if (err.kind === "payment_required" && est?.pool) {
          const remaining = await balances({ fresh: true }).then((b) => b[est.pool as CreditPool].remaining).catch(() => null);
          if (remaining !== null) message = message.replace("credits for this call", `credits for this call (${fmt(remaining)} left)`);
        }
        return errorResult(message);
      }
      log("exception", err instanceof Error ? err.name : "unknown");
      deps.logger.error({ tool: tool.name, err_name: err instanceof Error ? err.name : "unknown" }, "tool handler failed");
      return errorResult("Something went wrong on the Bill of Lading Data MCP server. Try again; if it persists, contact support.");
    } finally {
      release();
    }
  }

  /**
   * The credit guard (brief: "Before each paid call"). Returns a result to send
   * instead of calling the API, or null to go ahead.
   */
  async function guard(
    tool: ToolDefinition,
    args: Record<string, unknown>,
    est: Estimate & { pool: CreditPool },
    caller: CallerContext,
    binding: string,
    balances: (o?: { fresh?: boolean }) => Promise<Balances>,
    extra: Extra,
  ): Promise<{ result: ToolCallResult; outcome: ToolCallLog["outcome"] } | null> {
    const remaining = (await balances())[est.pool].remaining;
    const spentToday = await deps.dailySpend.get(binding, utcDay());
    const maxCreditsArg = typeof args.max_credits === "number" ? args.max_credits : undefined;
    const decision = decide({ estimate: est, isUnlock: Boolean(tool.unlock), settings: caller.settings, maxCreditsArg, spentToday, remaining });

    if (decision.action === "proceed") return null;
    if (decision.action === "refuse") return { result: errorResult(decision.message), outcome: "tool_error" };

    // A valid token for exactly this call means the user already agreed.
    const token = typeof args.confirmation_token === "string" ? args.confirmation_token : undefined;
    let tokenProblem: string | null = null;
    if (token) {
      const v = await deps.confirmations.verify(token, binding, tool.name, args);
      if (v.ok) return null;
      tokenProblem = {
        expired: "That confirmation has expired.",
        used: "That confirmation was already used.",
        mismatch: "That confirmation was for a different call (the arguments must be identical).",
        invalid: "That confirmation token is not valid.",
      }[v.reason];
    }

    const label = POOL_LABEL[est.pool];
    const question =
      `${tool.title}: this can use up to ${fmt(est.max_credits)} ${label} credits (${est.basis}). ` +
      `You have ${remaining === null ? "an unknown number of" : fmt(remaining)} ${label} credits left. Go ahead?`;

    // Ask the user directly when the client supports elicitation.
    if (!token && server.server.getClientCapabilities()?.elicitation) {
      try {
        const answer = await extra.sendRequest(
          {
            method: "elicitation/create",
            params: {
              mode: "form",
              message: `${question}\n${decision.reasons.join(" ")}`,
              requestedSchema: { type: "object", properties: { confirm: { type: "boolean", title: "Spend the credits", description: question, default: false } }, required: ["confirm"] },
            },
          },
          ElicitResultSchema,
          { timeout: ELICIT_TIMEOUT_MS },
        );
        if (answer.action === "accept" && answer.content?.confirm === true) return null;
        return {
          outcome: "confirmation_required",
          result: {
            content: [{ type: "text", text: "The user declined, so nothing was spent." }],
            structuredContent: { source: SOURCE, status: "cancelled", pool: est.pool },
          },
        };
      } catch {
        // Fall through to a confirmation token if elicitation fails or times out.
      }
    }

    const { token: newToken, expiresAt } = await deps.confirmations.issue(binding, tool.name, args);
    const message = `${tokenProblem ? `${tokenProblem} ` : ""}${question} Ask the user; if they agree, call ${tool.name} again with the same arguments plus this confirmation_token.`;
    return {
      outcome: "confirmation_required",
      result: {
        content: [{ type: "text", text: message }],
        structuredContent: {
          source: SOURCE,
          status: "confirmation_required",
          pool: est.pool,
          confirmation: {
            message,
            reasons: decision.reasons,
            pool: est.pool,
            estimated_max_credits: est.max_credits,
            pool_remaining: remaining,
            confirmation_token: newToken,
            expires_at: expiresAt,
          },
        },
      },
    };
  }

  /** After a paid call: credits used (estimated), refreshed pool balance, next page cost, daily spend. */
  async function settle(
    tool: ToolDefinition,
    args: Record<string, unknown>,
    billing: BillingOutcome | undefined,
    binding: string,
    balances: (o?: { fresh?: boolean }) => Promise<Balances>,
  ) {
    const key = costKeyFor(tool.name, args);
    const cost = key ? deps.costs[key] : undefined;
    const pool = cost && cost.unit !== "free" ? cost.pool : null;
    const credits_used = cost ? creditsUsed(cost, billing) : 0;
    let credits_remaining: number | null = null;
    if (pool) {
      if (credits_used > 0) await deps.dailySpend.add(binding, utcDay(), credits_used);
      credits_remaining = await balances({ fresh: credits_used > 0 })
        .then((b) => b[pool].remaining)
        .catch(() => null);
    }
    return {
      status: "ok" as const,
      pool,
      credits_used,
      credits_used_is_estimate: true,
      credits_remaining,
      ...(cost?.unit === "per_record" ? { next_page_cost_credits: nextPageCost(deps.costs, tool.name, args) } : {}),
    };
  }
}
