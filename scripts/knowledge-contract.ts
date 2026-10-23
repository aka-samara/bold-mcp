// Compares the knowledge tools this server offers with the ones the sales
// assistant's knowledge API lists (GET {BOLD_KNOWLEDGE_URL}/api/kb/v1/tools):
// same names, same input schemas (descriptions aside). Run after either side
// changes:  BOLD_KNOWLEDGE_URL=… BOLD_KNOWLEDGE_TOKEN=… npm run check:knowledge
// The token goes only in the Authorization header and is never printed.
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { KNOWLEDGE_TOOLS, loadCoreConfig } from "@bold-mcp/core";

const ListSchema = z.object({ tools: z.array(z.object({ name: z.string(), input_schema: z.record(z.string(), z.unknown()) })) });

const IGNORED = new Set(["description", "additionalProperties", "$schema", "title"]);

/** A JSON Schema without the parts that don't change what input is accepted, keys sorted. */
export function normalize(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(normalize);
  if (schema && typeof schema === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(schema).sort()) {
      if (IGNORED.has(k)) continue;
      const v = (schema as Record<string, unknown>)[k];
      out[k] = k === "required" && Array.isArray(v) ? [...v].sort() : normalize(v);
    }
    return out;
  }
  return schema;
}

export function ourSchemas(): Map<string, unknown> {
  return new Map(KNOWLEDGE_TOOLS.map((t) => [t.name, z.toJSONSchema(t.inputSchema, { io: "input" })]));
}

/** Plain-words differences; empty when both sides agree. */
export function compareTools(ours: Map<string, unknown>, theirs: Map<string, unknown>): string[] {
  const problems: string[] = [];
  for (const name of ours.keys()) if (!theirs.has(name)) problems.push(`${name}: offered here but not by the knowledge API`);
  for (const name of theirs.keys()) if (!ours.has(name)) problems.push(`${name}: offered by the knowledge API but not here`);
  for (const [name, schema] of ours) {
    const other = theirs.get(name);
    if (other === undefined) continue;
    const a = JSON.stringify(normalize(schema));
    const b = JSON.stringify(normalize(other));
    if (a !== b) problems.push(`${name}: input schema differs\n    here: ${a}\n    API:  ${b}`);
  }
  return problems;
}

async function main() {
  const config = loadCoreConfig();
  if (!config.BOLD_KNOWLEDGE_URL || !config.BOLD_KNOWLEDGE_TOKEN) {
    process.stderr.write("Set BOLD_KNOWLEDGE_URL and BOLD_KNOWLEDGE_TOKEN to check the knowledge API.\n");
    process.exit(2);
  }
  const res = await fetch(`${config.BOLD_KNOWLEDGE_URL}/api/kb/v1/tools`, {
    headers: { accept: "application/json", authorization: `Bearer ${config.BOLD_KNOWLEDGE_TOKEN}` },
    signal: AbortSignal.timeout(config.BOLD_API_TIMEOUT_MS),
    redirect: "error",
  });
  if (!res.ok) {
    process.stderr.write(`The knowledge API answered HTTP ${res.status}.\n`);
    process.exit(1);
  }
  const list = ListSchema.parse(await res.json());
  const problems = compareTools(ourSchemas(), new Map(list.tools.map((t) => [t.name, t.input_schema])));
  for (const p of problems) console.log(`DIFF  ${p}`);
  console.log(problems.length ? `${problems.length} difference(s)` : `All ${list.tools.length} knowledge tools match`);
  process.exit(problems.length ? 1 : 0);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
