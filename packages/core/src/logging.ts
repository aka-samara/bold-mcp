import { pino, type DestinationStream, type Logger } from "pino";

export type { Logger } from "pino";

/**
 * Paths pino replaces with "[redacted]" wherever they appear. A safety net
 * only: code never passes keys or tokens to the logger in the first place
 * (lint rule + key-safety tests).
 */
export const REDACT_PATHS = [
  "apiKey",
  "api_key",
  "key",
  "token",
  "accessToken",
  "refreshToken",
  "authorization",
  "*.apiKey",
  "*.api_key",
  "*.key",
  "*.token",
  "*.authorization",
  "req.headers.authorization",
  "req.headers['api-key']",
  "req.headers.cookie",
  "headers.authorization",
  "headers['api-key']",
];

export function createLogger(opts: { level?: string; name?: string } = {}, destination?: DestinationStream): Logger {
  return pino(
    {
      name: opts.name ?? "bold-mcp",
      level: opts.level ?? "info",
      redact: { paths: REDACT_PATHS, censor: "[redacted]" },
      base: undefined,
      timestamp: pino.stdTimeFunctions.isoTime,
    },
    destination,
  );
}

/** Fields logged for every tool call (brief: coding rules). Never arguments or results. */
export interface ToolCallLog {
  tool: string;
  connection_id: string | null;
  key_fp: string;
  auth_mode: string;
  pool: string | null;
  credits_estimated: number;
  latency_ms: number;
  outcome: "ok" | "tool_error" | "rate_limited" | "invalid_key" | "confirmation_required" | "exception";
  error_kind?: string;
  upstream_calls?: number;
}
