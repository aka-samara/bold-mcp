// Copy non-TypeScript assets (SQL migrations) next to the compiled output.
import { cpSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
cpSync(`${root}packages/http-server/src/db/migrations`, `${root}packages/http-server/dist/db/migrations`, { recursive: true });
