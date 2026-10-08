import { Redis } from "ioredis";
import {
  ConfirmationTokens,
  createCoreDeps,
  PartnerApiClient,
  type CoreDeps,
  type Logger,
} from "@bold-mcp/core";
import type { HttpConfig } from "./config.js";
import { MemoryKeyValidityCache, type KeyValidityCache } from "./auth/key-validator.js";
import { MemoryDb } from "./db/memory.js";
import { migrate, PostgresDb } from "./db/postgres.js";
import type { Db } from "./db/types.js";
import { CimdFetcher } from "./oauth/cimd.js";
import { Csrf } from "./oauth/csrf.js";
import { TokenService } from "./oauth/tokens.js";
import { MemoryEphemeralStore, type EphemeralStore } from "./state/ephemeral.js";
import {
  RedisBalanceCache,
  RedisConfirmationStore,
  RedisDailySpendStore,
  RedisEphemeralStore,
  RedisKeyValidityCache,
  RedisRateLimitStore,
} from "./state/redis.js";
import { Metrics } from "./metrics.js";
import { KeyVault } from "./vault/key-vault.js";
import { LocalKms, type Kms } from "./vault/kms.js";
import { randomBytes } from "node:crypto";

/** Everything the HTTP app needs, built once at start-up. Stand-ins are used where real services are not configured. */
export interface Services {
  config: HttpConfig;
  deps: CoreDeps;
  db: Db;
  vault: KeyVault;
  tokens: TokenService;
  ephemeral: EphemeralStore;
  keyCache: KeyValidityCache;
  cimd: CimdFetcher;
  csrf: Csrf;
  /** Short-timeout client for checking pasted keys (OAuth endpoints must answer within 10 s). */
  validationClient: PartnerApiClient;
  redis: Redis | null;
  metrics: Metrics;
  close(): Promise<void>;
}

export interface ServiceOverrides {
  db?: Db;
  kms?: Kms;
  cimd?: CimdFetcher;
  fetch?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  deps?: CoreDeps;
}

export async function buildServices(config: HttpConfig, logger: Logger, o: ServiceOverrides = {}): Promise<Services> {
  const redis = config.REDIS_URL ? new Redis(config.REDIS_URL, { maxRetriesPerRequest: 2, enableReadyCheck: true, lazyConnect: false }) : null;
  if (!redis) logger.warn("REDIS_URL not set: using in-memory state (single instance, local use only)");

  let db = o.db;
  if (!db) {
    if (config.DATABASE_URL) {
      const pg = PostgresDb.fromUrl(config.DATABASE_URL);
      const applied = await migrate(pg.pool);
      if (applied.length) logger.info({ applied }, "database migrations applied");
      db = pg;
    } else {
      logger.warn("DATABASE_URL not set: using in-memory database (connections are lost on restart)");
      db = new MemoryDb();
    }
  }

  let kms = o.kms;
  if (!kms) {
    if (!config.BOLD_LOCAL_KMS_KEY) {
      logger.warn("BOLD_LOCAL_KMS_KEY not set: using a random per-process key-encryption key (stored keys are unreadable after restart)");
      kms = new LocalKms(randomBytes(32).toString("base64"), "local-ephemeral");
    } else {
      kms = new LocalKms(config.BOLD_LOCAL_KMS_KEY);
    }
  }

  const deps =
    o.deps ??
    createCoreDeps(config, logger, {
      ...(o.fetch ? { fetch: o.fetch } : {}),
      ...(o.env ? { env: o.env } : {}),
      ...(config.BOLD_CONFIRMATION_SECRET ? { confirmationSecret: config.BOLD_CONFIRMATION_SECRET } : {}),
      ...(redis
        ? {
            rateLimits: new RedisRateLimitStore(redis),
            balances: new RedisBalanceCache(redis),
            confirmationStore: new RedisConfirmationStore(redis),
            dailySpend: new RedisDailySpendStore(redis),
          }
        : {}),
    });
  // Every tool call goes to the usage log (no arguments or results) and the metrics.
  const dbRef = db;
  const metrics = new Metrics();
  deps.onToolCall = (entry) => {
    metrics.toolCalls.inc({ tool: entry.tool, outcome: entry.outcome, auth_mode: entry.auth_mode });
    metrics.toolDuration.observe({ tool: entry.tool }, entry.latency_ms / 1000);
    if (entry.credits_used && entry.pool) metrics.creditsUsed.inc({ tool: entry.tool, pool: entry.pool }, entry.credits_used);
    if (entry.outcome === "rate_limited") metrics.rateLimited.inc({ scope: entry.error_kind ?? "unknown" });
    void dbRef.usage.record(entry).catch(() => logger.warn("usage_log write failed"));
  };
  deps.onUnlock = (entry) => {
    metrics.unlocks.inc({ tool: entry.tool });
    void dbRef.audit.record(entry).catch(() => logger.error({ tool: entry.tool, connection_id: entry.connection_id }, "unlock_audit write failed"));
  };

  return {
    config,
    deps,
    db,
    vault: new KeyVault(kms),
    tokens: new TokenService(db),
    ephemeral: redis ? new RedisEphemeralStore(redis) : new MemoryEphemeralStore(),
    keyCache: redis ? new RedisKeyValidityCache(redis) : new MemoryKeyValidityCache(),
    cimd: o.cimd ?? new CimdFetcher(),
    csrf: new Csrf(config.BOLD_CSRF_SECRET ?? ConfirmationTokens.randomSecret()),
    validationClient: new PartnerApiClient({ baseUrl: config.BOLD_API_BASE_URL, timeoutMs: 8000, maxRetries: 0, ...(o.fetch ? { fetch: o.fetch } : {}) }),
    redis,
    metrics,
    async close() {
      await db.close();
      redis?.disconnect();
    },
  };
}
