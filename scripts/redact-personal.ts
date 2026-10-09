// Replaces personal data in recorded contact fixtures with placeholders that
// keep the shape (types, array lengths, email domains), so real people's
// names, profiles and unlocked emails or phones never land in the repo.
//
//   node --experimental-strip-types scripts/redact-personal.ts   # rewrite test/fixtures/recorded in place
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

export const PERSONAL_PATHS = new Set(["company-contacts", "advanced-company-contacts", "contact-look-up"]);

const TEXT_KEYS = new Set(["name", "linkedin_url", "location", "city", "region", "phone", "number"]);
const NUMBER_KEYS = new Set(["region_latitude", "region_longitude", "birth_year"]);

function redact(value: unknown, key = ""): unknown {
  if (Array.isArray(value)) return value.map((v) => redact(v, key));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, redact(v, k)]));
  }
  if (typeof value === "string") {
    if (key === "email" || /@/.test(value)) return `redacted@${value.split("@")[1] ?? "example.com"}`;
    if (key === "phones" || key === "phone" || key === "number") return "+00 0000 0000";
    if (TEXT_KEYS.has(key)) return key === "linkedin_url" ? "https://www.linkedin.com/in/redacted" : "Redacted";
    if (key === "preview") return "Redacted";
  }
  if (typeof value === "number" && NUMBER_KEYS.has(key)) return 0;
  return value;
}

/** The fixture with personal data replaced, when its path returns people; unchanged otherwise. */
export function redactPersonal<T>(path: string, fixture: T): T {
  return PERSONAL_PATHS.has(path) ? (redact(fixture) as T) : fixture;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = join(fileURLToPath(new URL("..", import.meta.url)), "test/fixtures/recorded");
  for (const path of PERSONAL_PATHS) {
    const file = join(dir, `${path}.json`);
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    writeFileSync(file, `${JSON.stringify(redactPersonal(path, JSON.parse(text)), null, 2)}\n`);
    console.log(`redacted ${path}.json`);
  }
}
