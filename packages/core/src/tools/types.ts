import type { z } from "zod";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { EndpointPath } from "../client/endpoints.js";
import type { PartnerApiClient } from "../client/partner-client.js";
import type { CostTable } from "../billing/costs.js";
import type { ConcurrencyLimiter, RateLimitStore } from "../limits/rate-limit.js";
import type { Logger } from "../logging.js";

export type AuthMode = "header" | "oauth" | "stdio";

/** Per-connection spending settings (brief: "Spending settings per connection"). */
export interface SpendingSettings {
  perCallLimit: number;
  dailyLimit: number;
  allowContactUnlocks: boolean;
  allowKybUnlocks: boolean;
}

export const DEFAULT_SETTINGS: SpendingSettings = {
  perCallLimit: 150,
  dailyLimit: 2000,
  allowContactUnlocks: true,
  allowKybUnlocks: true,
};

/**
 * Who is calling. Built by the transport for each request; the key lives only
 * here, in memory, for the duration of the request.
 */
export interface CallerContext {
  apiKey: string;
  fingerprint: string;
  connectionId: string | null;
  authMode: AuthMode;
  /** Header mode: result of the cached Credit Usage check. */
  keyStatus: "valid" | "invalid" | "unknown";
  settings: SpendingSettings;
  /** OAuth mode: called when the Partner API rejects the stored key. */
  onKeyRejected?: () => Promise<void> | void;
}

export interface CoreDeps {
  client: PartnerApiClient;
  costs: CostTable;
  rateLimits: RateLimitStore;
  concurrency: ConcurrencyLimiter;
  logger: Logger;
}

/** What a tool handler gets. `call` applies upstream limits and keeps the key out of the handler. */
export interface ToolRuntime {
  deps: CoreDeps;
  caller: Omit<CallerContext, "apiKey" | "onKeyRejected">;
  call(path: EndpointPath, body: Record<string, unknown>): Promise<unknown>;
  signal: AbortSignal | undefined;
}

export interface ToolResult<O> {
  structured: O;
  /** Short plain-text summary. Never includes free text from API data. */
  summary: string;
}

export interface ToolDefinition<I extends z.ZodObject = z.ZodObject, O extends z.ZodObject = z.ZodObject> {
  name: string;
  title: string;
  /** Static text; first line is the cost and pool. Under 1,000 characters. */
  description: string;
  inputSchema: I;
  outputSchema: O;
  annotations: ToolAnnotations;
  endpoints: readonly EndpointPath[];
  handler(args: z.output<I>, rt: ToolRuntime): Promise<ToolResult<z.output<O>>>;
}

export function defineTool<I extends z.ZodObject, O extends z.ZodObject>(def: ToolDefinition<I, O>): ToolDefinition<I, O> {
  return def;
}

/** Annotations for free, read-only, idempotent tools. */
export const FREE_READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};
