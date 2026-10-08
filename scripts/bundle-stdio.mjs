// Bundle the stdio package with the private @bold-mcp/core inlined, so the
// published npm package needs only public dependencies (decision D18).
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
await build({
  entryPoints: [`${root}packages/stdio/src/index.ts`],
  outfile: `${root}packages/stdio/bundle/index.js`,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  alias: { "@bold-mcp/core": `${root}packages/core/src/index.ts` },
  external: ["@modelcontextprotocol/sdk", "@modelcontextprotocol/sdk/*", "zod", "pino", "jose"],
  legalComments: "none",
  logLevel: "warning",
});
