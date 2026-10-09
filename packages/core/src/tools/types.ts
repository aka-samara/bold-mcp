import type { z } from "zod";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";
import type { EndpointPath } from "../client/endpoints.js";
import type { PartnerApiClient } from "../client/partner-client.js";
import type { CostTable } from "../billing/costs.js";
import type { ConcurrencyLimiter, RateLimitStore } from "../limits/rate-limit.js";
import type { BalanceCache } from "../billing/balance-cache.js";
import type { ConfirmationTokens } from "../billing/confirmation.js";
import type { DailySpendStore } from "../billing/daily-spend.js";
import type { BillingOutcome } from "../billing/actual.js";
import type { Balances } from "../shaping/credits.js";
import type { Logger, ToolCallLog } from "../logging.js";

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
  balances: BalanceCache;
  confirmations: ConfirmationTokens;
  dailySpend: DailySpendStore;
  /** Called after every tool call (e.g. to write the usage log). */
  onToolCall?: (entry: ToolCallLog) => void;
  /** Called after every unlock that returned data (brief: audit-log each unlock). */
  onUnlock?: (entry: UnlockAuditEntry) => void;
}

export interface UnlockAuditEntry extends UnlockAudit {
  tool: string;
  connection_id: string | null;
  key_fp: string;
  credits_used: number;
  at: string;
}

/** What a tool handler gets. `call` applies upstream limits and keeps the key out of the handler. */
export interface ToolRuntime {
  deps: CoreDeps;
  caller: Omit<CallerContext, "apiKey" | "onKeyRejected">;
  call(path: EndpointPath, body: Record<string, unknown>): Promise<unknown>;
  /** Pool balances from Credit Usage, cached 60 s per key. */
  balances(opts?: { fresh?: boolean }): Promise<Balances>;
  signal: AbortSignal | undefined;
}

export interface ToolResult<O> {
  structured: O;
  /** Short plain-text summary. Never includes free text from API data. */
  summary: string;
  /** Paid tools: what was returned, for credits_used. */
  billing?: BillingOutcome;
  /** Unlock tools: what was unlocked, for the audit log (ids and types only, never the revealed details). */
  audit?: UnlockAudit;
}

export interface UnlockAudit {
  subject_type: "contact" | "kyb";
  subject_id: string;
  /** Lookup types or sections that returned data. */
  unlocked: string[];
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
  /** Can spend credits: goes through the credit guard and gets credit fields in its output. */
  paid?: boolean;
  /** Contact/KYB unlock: always needs confirmation and respects the allow switches. */
  unlock?: boolean;
  handler(args: z.output<I>, rt: ToolRuntime): Promise<ToolResult<z.output<O>>>;
}

export function defineTool<I extends z.ZodObject, O extends z.ZodObject>(def: ToolDefinition<I, O>): ToolDefinition<I, O> {
  return def;
}

/** Paid tools: read-only and open-world (brief); not idempotent because each call is charged. */
export const PAID_READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
};

/** Unlock tools (brief: read-only, non-destructive, idempotent, open-world; safety comes from server confirmation). */
export const UNLOCK_ANNOTATIONS: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

/** Annotations for free, read-only, idempotent tools. */
export const FREE_READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};
