import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createApp } from "../../packages/http-server/src/app.ts";
import { loadHttpConfig } from "../../packages/http-server/src/config.ts";
import { testDeps } from "./harness.ts";

export async function startHttp(env: NodeJS.ProcessEnv = {}) {
  const { deps, logs } = testDeps(env);
  const config = loadHttpConfig({ BOLD_PUBLIC_URL: "https://mcp.test.example", ...env });
  const { app, sessions } = createApp({ config, deps });
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url,
    logs,
    sessions,
    async connect(headers: Record<string, string>) {
      const client = new Client({ name: "http-test", version: "1.0.0" });
      const transport = new StreamableHTTPClientTransport(new URL(`${url}/mcp`), { requestInit: { headers } });
      await client.connect(transport);
      return { client, transport };
    },
    async stop() {
      await sessions.closeAll();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}

export const INIT_BODY = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "raw", version: "1" } },
};
