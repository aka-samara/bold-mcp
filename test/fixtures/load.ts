import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { z } from "zod";
import { isEndpointPath, type EndpointPath } from "@bold-mcp/core";

/** The `{ code, message, data }` envelope every Partner API path returns. */
export const EnvelopeSchema = z.object({
  code: z.number().int(),
  message: z.string(),
  data: z.unknown(),
});

const RecordedResponseSchema = z.object({
  status: z.number().int(),
  body: EnvelopeSchema,
});

export const FixtureSchema = z.object({
  _meta: z.object({ path: z.string(), synthetic: z.boolean(), note: z.string().optional() }),
  request: z.record(z.string(), z.unknown()),
  responses: z.record(z.string(), RecordedResponseSchema).refine((r) => "ok" in r, "needs an `ok` response"),
});
export type Fixture = z.infer<typeof FixtureSchema>;

const ErrorsSchema = z.object({ errors: z.record(z.string(), RecordedResponseSchema) });

const root = fileURLToPath(new URL(".", import.meta.url));
const SYNTHETIC = join(root, "synthetic");
const RECORDED = join(root, "recorded");

function readDir(dir: string): string[] {
  try {
    return readdirSync(dir).filter((f) => f.endsWith(".json") && !f.startsWith("_"));
  } catch {
    return [];
  }
}

export type FixtureSource = "synthetic" | "recorded";

/**
 * Fixtures by path. Synthetic fixtures carry the known values the contract
 * tests assert on; recorded live responses (test/fixtures/recorded) are served
 * with `"recorded"`, falling back to synthetic for paths not recorded.
 */
export function loadFixtures(source: FixtureSource = "synthetic"): Map<EndpointPath, Fixture> {
  const out = new Map<EndpointPath, Fixture>();
  for (const dir of source === "recorded" ? [SYNTHETIC, RECORDED] : [SYNTHETIC]) {
    for (const file of readDir(dir)) {
      const fixture = FixtureSchema.parse(JSON.parse(readFileSync(join(dir, file), "utf8")));
      const path = fixture._meta.path;
      if (!isEndpointPath(path)) throw new Error(`${file}: unknown endpoint path ${path}`);
      if (`${path}.json` !== file) throw new Error(`${file}: file name must match _meta.path`);
      out.set(path, fixture);
    }
  }
  return out;
}

/** Recorded paths only, for tests that check live shapes. */
export function loadRecordedFixtures(): Map<EndpointPath, Fixture> {
  const synthetic = loadFixtures("synthetic");
  const merged = loadFixtures("recorded");
  return new Map([...merged].filter(([path, f]) => f !== synthetic.get(path) && !f._meta.synthetic));
}

/** Error envelopes; recorded ones (test/fixtures/recorded/_errors.json) win. */
export function loadErrorFixtures(): z.infer<typeof ErrorsSchema>["errors"] {
  const synthetic = ErrorsSchema.parse(JSON.parse(readFileSync(join(SYNTHETIC, "_errors.json"), "utf8"))).errors;
  let recorded: typeof synthetic = {};
  try {
    recorded = ErrorsSchema.parse(JSON.parse(readFileSync(join(RECORDED, "_errors.json"), "utf8"))).errors;
  } catch {
    // nothing recorded yet
  }
  return { ...synthetic, ...recorded };
}
