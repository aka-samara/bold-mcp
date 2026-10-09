import { z } from "zod";

export const DEFAULT_API_BASE_URL = "https://tradedata.billofladingdata.com/partner-api";

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v.trim() === "" ? undefined : v.trim()));

/**
 * Environment shared by every package. Validated once at start-up; a bad value
 * stops the process with a message that names the variable but never echoes
 * its value (values may be API keys).
 */
export const CoreConfigSchema = z.object({
  BOLD_API_BASE_URL: optionalString
    .pipe(
      z
        .url({ protocol: /^https?$/ })
        .refine((u) => !/[?#]/.test(u), "must not contain a query string or fragment")
        .optional(),
    )
    .transform((v) => (v ?? DEFAULT_API_BASE_URL).replace(/\/+$/, "")),
  BOLD_API_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(25_000),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export type CoreConfig = z.output<typeof CoreConfigSchema>;

/** An API key as accepted from the environment or a header. Never logged. */
export const ApiKeySchema = z
  .string()
  .trim()
  .min(16, "looks too short to be an API key")
  .max(256, "looks too long to be an API key")
  .regex(/^[\x21-\x7e]+$/, "must be printable ASCII without spaces");

export class ConfigError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid configuration:\n  - ${issues.join("\n  - ")}`);
    this.name = "ConfigError";
  }
}

/** Issue text built from path + message only, so secret values never appear. */
export function describeIssues(error: z.ZodError): string[] {
  return error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
}

export function loadCoreConfig(env: NodeJS.ProcessEnv = process.env): CoreConfig {
  const parsed = CoreConfigSchema.safeParse(env);
  if (!parsed.success) throw new ConfigError(describeIssues(parsed.error));
  return parsed.data;
}

/**
 * Read an API key from one of the named variables (first non-empty wins).
 * Returns undefined when none is set; throws ConfigError (without the value)
 * when one is set but malformed.
 */
export function readApiKey(names: readonly string[], env: NodeJS.ProcessEnv = process.env): string | undefined {
  for (const name of names) {
    const raw = env[name];
    if (raw === undefined || raw.trim() === "") continue;
    const parsed = ApiKeySchema.safeParse(raw);
    if (!parsed.success) {
      throw new ConfigError(parsed.error.issues.map((i) => `${name}: ${i.message}`));
    }
    return parsed.data;
  }
  return undefined;
}
