#!/usr/bin/env node
import { ConfigError, loadCoreConfig, readApiKey } from "@bold-mcp/core";

// M0 placeholder: validates config at start-up. Tools are registered in M1.
try {
  loadCoreConfig();
  if (!readApiKey(["BOLD_API_KEY"])) {
    process.stderr.write("BOLD_API_KEY is not set. Set it to your Bill of Lading Data API key.\n");
    process.exit(1);
  }
} catch (err) {
  if (err instanceof ConfigError) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }
  throw err;
}
