import { ConfigError, createCoreDeps, createLogger } from "@bold-mcp/core";
import { createApp } from "./app.js";
import { loadHttpConfig, type HttpConfig } from "./config.js";

let config: HttpConfig;
try {
  config = loadHttpConfig();
} catch (err) {
  if (err instanceof ConfigError) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }
  throw err;
}

const logger = createLogger({ level: config.LOG_LEVEL, name: "bold-mcp-http" });
const deps = createCoreDeps(config, logger);
const { app, sessions } = createApp({ config, deps });

const server = app.listen(config.PORT, config.HOST, () => {
  logger.info({ port: config.PORT, public_url: config.BOLD_PUBLIC_URL, api_base: config.BOLD_API_BASE_URL }, "listening");
});

async function shutdown(signal: string) {
  logger.info({ signal }, "shutting down");
  server.close();
  await sessions.closeAll();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
