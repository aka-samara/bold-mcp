import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ElicitRequestSchema, type ElicitResult } from "@modelcontextprotocol/sdk/types.js";
import { createApp } from "../../packages/http-server/src/app.ts";
import { loadHttpConfig } from "../../packages/http-server/src/config.ts";
import { buildServices, type ServiceOverrides } from "../../packages/http-server/src/services.ts";
import { testDeps } from "./harness.ts";

export async function startHttp(env: NodeJS.ProcessEnv = {}, overrides: ServiceOverrides = {}) {
  const { deps, logs } = testDeps(env);
  const config = loadHttpConfig({ BOLD_PUBLIC_URL: "https://mcp.test.example", ...env });
  const services = await buildServices(config, deps.logger, { deps, ...overrides });
  const { app, sessions } = createApp(services);
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    url,
    logs,
    sessions,
    services,
    async connect(headers: Record<string, string>, elicit?: () => ElicitResult) {
      const client = new Client({ name: "http-test", version: "1.0.0" }, elicit ? { capabilities: { elicitation: { form: {} } } } : undefined);
      if (elicit) client.setRequestHandler(ElicitRequestSchema, async () => elicit());
      const transport = new StreamableHTTPClientTransport(new URL(`${url}/mcp`), { requestInit: { headers } });
      await client.connect(transport);
      return { client, transport };
    },
    async stop() {
      await sessions.closeAll();
      await new Promise<void>((r) => server.close(() => r()));
      await services.close();
    },
  };
}

export const INIT_BODY = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "raw", version: "1" } },
};
