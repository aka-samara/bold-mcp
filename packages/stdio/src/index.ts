#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ConfigError, createBoldServer, createCoreDeps, createLogger, DEFAULT_SETTINGS, keyFingerprint, loadCoreConfig, readApiKey, type CallerContext } from "@bold-mcp/core";
import { pino } from "pino";

// stdout carries the MCP protocol; logs go to stderr.
function fail(message: string): never {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

let apiKey: string | undefined;
let config;
try {
  config = loadCoreConfig();
  apiKey = readApiKey(["BOLD_API_KEY"]);
} catch (err) {
  if (err instanceof ConfigError) fail(err.message);
  throw err;
}
if (!apiKey) fail("BOLD_API_KEY is not set. Set it to your Bill of Lading Data API key (find it in your account's API settings).");

const logger = createLogger({ level: config.LOG_LEVEL === "info" ? "warn" : config.LOG_LEVEL, name: "bold-mcp-stdio" }, pino.destination(2));
const deps = createCoreDeps(config, logger);
const caller: CallerContext = {
  apiKey,
  fingerprint: keyFingerprint(apiKey),
  connectionId: null,
  authMode: "stdio",
  keyStatus: "unknown",
  settings: {
    ...DEFAULT_SETTINGS,
    perCallLimit: Number(process.env.BOLD_MAX_CREDITS ?? DEFAULT_SETTINGS.perCallLimit) || DEFAULT_SETTINGS.perCallLimit,
    dailyLimit: Number(process.env.BOLD_DAILY_CREDITS ?? DEFAULT_SETTINGS.dailyLimit) || DEFAULT_SETTINGS.dailyLimit,
    allowContactUnlocks: process.env.BOLD_ALLOW_CONTACTS !== "false",
    allowKybUnlocks: process.env.BOLD_ALLOW_KYB !== "false",
  },
};

const server = createBoldServer({ deps, getCaller: () => caller });
await server.connect(new StdioServerTransport());
