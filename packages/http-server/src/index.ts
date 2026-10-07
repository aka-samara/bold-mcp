import { loadCoreConfig } from "@bold-mcp/core";

// M0 placeholder: validates config at start-up. The Streamable HTTP server
// (header mode) lands in M1 and the OAuth sign-in in M3.
const config = loadCoreConfig();
process.stdout.write(`bold-mcp http-server: config ok (base URL ${config.BOLD_API_BASE_URL})\n`);
