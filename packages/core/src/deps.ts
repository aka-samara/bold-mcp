import { MemoryBalanceCache, type BalanceCache } from "./billing/balance-cache.js";
import { ConfirmationTokens, MemoryConfirmationStore, type ConfirmationStore } from "./billing/confirmation.js";
import { loadCostTable } from "./billing/costs.js";
import { MemoryDailySpendStore, type DailySpendStore } from "./billing/daily-spend.js";
import { PartnerApiClient } from "./client/partner-client.js";
import type { CoreConfig } from "./config.js";
import { ConcurrencyLimiter, CONNECTION_CONCURRENCY, MemoryRateLimitStore, type RateLimitStore } from "./limits/rate-limit.js";
import type { Logger } from "./logging.js";
import type { CoreDeps } from "./tools/types.js";

export interface DepsOverrides {
  fetch?: typeof fetch;
  env?: NodeJS.ProcessEnv;
  rateLimits?: RateLimitStore;
  balances?: BalanceCache;
  confirmationStore?: ConfirmationStore;
  /** At least 32 bytes. Random per process when omitted (fine for stdio and a single instance). */
  confirmationSecret?: string | Uint8Array;
  dailySpend?: DailySpendStore;
}

export function createCoreDeps(config: CoreConfig, logger: Logger, overrides: DepsOverrides = {}): CoreDeps {
  return {
    client: new PartnerApiClient({ baseUrl: config.BOLD_API_BASE_URL, timeoutMs: config.BOLD_API_TIMEOUT_MS, ...(overrides.fetch ? { fetch: overrides.fetch } : {}) }),
    costs: loadCostTable(overrides.env),
    rateLimits: overrides.rateLimits ?? new MemoryRateLimitStore(),
    concurrency: new ConcurrencyLimiter(CONNECTION_CONCURRENCY),
    logger,
    balances: overrides.balances ?? new MemoryBalanceCache(),
    confirmations: new ConfirmationTokens(overrides.confirmationSecret ?? ConfirmationTokens.randomSecret(), overrides.confirmationStore ?? new MemoryConfirmationStore()),
    dailySpend: overrides.dailySpend ?? new MemoryDailySpendStore(),
  };
}
