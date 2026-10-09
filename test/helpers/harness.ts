import { Writable } from "node:stream";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import {
  createBoldServer,
  createCoreDeps,
  createLogger,
  DEFAULT_SETTINGS,
  keyFingerprint,
  loadCoreConfig,
  type CallerContext,
  type CoreDeps,
} from "@bold-mcp/core";

/** Fake key built at runtime; tests assert it never leaks. */
export const FAKE_KEY = ["tk", "9f3a71c2", "-test-only-not-a-real-key-000000"].join("");
export const BAD_KEY = ["bad", "c0ffee11", "-rejected-test-key-000000000"].join("");

/** A logger whose output is kept in memory so tests can search it. */
export function memoryLogger() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(String(chunk));
      cb();
    },
  });
  return { logger: createLogger({ level: "debug" }, stream), lines };
}

export function testDeps(env: NodeJS.ProcessEnv = {}): { deps: CoreDeps; logs: string[] } {
  const { logger, lines } = memoryLogger();
  const deps = createCoreDeps(loadCoreConfig(env), logger, { env });
  // No waiting between retries in tests.
  (deps.client as unknown as { sleep: (ms: number) => Promise<void> }).sleep = async () => undefined;
  return { deps, logs: lines };
}

export function callerFor(apiKey: string, overrides: Partial<CallerContext> = {}): CallerContext {
  return {
    apiKey,
    fingerprint: keyFingerprint(apiKey),
    connectionId: null,
    authMode: "stdio",
    keyStatus: "unknown",
    settings: { ...DEFAULT_SETTINGS },
    ...overrides,
  };
}

/** An MCP client connected in memory to a fresh server. */
export async function connectInMemory(deps: CoreDeps, caller: CallerContext, protocolVersion?: string) {
  const server = createBoldServer({ deps, getCaller: () => caller });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-client", version: "1.0.0" }, protocolVersion ? { capabilities: {} } : undefined);
  await client.connect(clientTransport);
  return { client, server, close: async () => { await client.close(); await server.close(); } };
}
