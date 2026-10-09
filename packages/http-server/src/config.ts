import { z } from "zod";
import { CoreConfigSchema, ConfigError, describeIssues } from "@bold-mcp/core";

const DEFAULT_ORIGINS = ["https://claude.ai", "https://claude.com", "https://chatgpt.com", "https://chat.openai.com"];

export const HttpConfigSchema = CoreConfigSchema.extend({
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default("0.0.0.0"),
  /** Public origin of this server, e.g. https://mcp.billofladingdata.com (no path). */
  BOLD_PUBLIC_URL: z
    .url({ protocol: /^https?$/ })
    .default("http://localhost:3000")
    .transform((u) => u.replace(/\/+$/, "")),
  /** Extra browser origins allowed to call /mcp, comma-separated. Requests without Origin are always allowed. */
  BOLD_ALLOWED_ORIGINS: z
    .string()
    .optional()
    .transform((s) => [...DEFAULT_ORIGINS, ...(s ?? "").split(",").map((o) => o.trim()).filter(Boolean)]),
  /** How long a header-mode key's validity is cached, by fingerprint (brief: 5 minutes). */
  BOLD_KEY_CACHE_TTL_MS: z.coerce.number().int().min(1000).default(5 * 60_000),
  BOLD_SESSION_IDLE_MS: z.coerce.number().int().min(60_000).default(30 * 60_000),
  BOLD_MAX_SESSIONS: z.coerce.number().int().min(1).default(10_000),
  /** HMAC secret for confirmation tokens, shared by all instances (secrets manager). Random per process when unset outside production. */
  BOLD_CONFIRMATION_SECRET: z.string().min(32, "must be at least 32 characters").optional(),
}).superRefine((c, ctx) => {
  if (c.NODE_ENV === "production" && !c.BOLD_CONFIRMATION_SECRET)
    ctx.addIssue({ code: "custom", path: ["BOLD_CONFIRMATION_SECRET"], message: "is required in production" });
});

export type HttpConfig = z.output<typeof HttpConfigSchema>;

export function loadHttpConfig(env: NodeJS.ProcessEnv = process.env): HttpConfig {
  const parsed = HttpConfigSchema.safeParse(env);
  if (!parsed.success) throw new ConfigError(describeIssues(parsed.error));
  return parsed.data;
}
