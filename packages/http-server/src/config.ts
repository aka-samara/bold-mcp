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
  /** HMAC secret for connect-page CSRF tokens. Random per process when unset outside production. */
  BOLD_CSRF_SECRET: z.string().min(32, "must be at least 32 characters").optional(),
  /** Postgres for connections, clients, token hashes, usage log. Memory when unset (local only). */
  DATABASE_URL: z.string().optional(),
  /** Redis for confirmation tokens, rate limits, caches and OAuth codes. Memory when unset (local only). */
  REDIS_URL: z.string().optional(),
  /** Key-encryption key provider. "local" is the development stand-in. */
  BOLD_KMS_PROVIDER: z.enum(["local"]).default("local"),
  /** 32 bytes, base64. Required for the local KMS stand-in. */
  BOLD_LOCAL_KMS_KEY: z.string().optional(),
  BOLD_LOGO_URL: z.url().default("https://billofladingdata.com/assets/BLO-LOGO.png"),
  BOLD_FIND_KEY_URL: z.url().default("https://billofladingdata.com"),
  BOLD_TRIAL_URL: z.url().default("https://billofladingdata.com"),
  /** Proxies in front of the server (load balancer = 1). Client IPs for rate limits come from X-Forwarded-For only through these hops. */
  BOLD_TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  /** Private port for Prometheus /metrics. Off when unset. */
  BOLD_METRICS_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  /** Days a connection may sit unused before it expires (brief: 90). */
  BOLD_CONNECTION_IDLE_DAYS: z.coerce.number().int().min(1).default(90),
}).superRefine((c, ctx) => {
  if (c.NODE_ENV !== "production") return;
  for (const k of ["BOLD_CONFIRMATION_SECRET", "BOLD_CSRF_SECRET", "DATABASE_URL", "REDIS_URL"] as const) {
    if (!c[k]) ctx.addIssue({ code: "custom", path: [k], message: "is required in production" });
  }
  if (c.BOLD_KMS_PROVIDER === "local") ctx.addIssue({ code: "custom", path: ["BOLD_KMS_PROVIDER"], message: "must be a cloud KMS in production (local is a development stand-in)" });
  if (!c.BOLD_PUBLIC_URL.startsWith("https://")) ctx.addIssue({ code: "custom", path: ["BOLD_PUBLIC_URL"], message: "must be https in production" });
});

export type HttpConfig = z.output<typeof HttpConfigSchema>;

export function loadHttpConfig(env: NodeJS.ProcessEnv = process.env): HttpConfig {
  const parsed = HttpConfigSchema.safeParse(env);
  if (!parsed.success) throw new ConfigError(describeIssues(parsed.error));
  return parsed.data;
}
