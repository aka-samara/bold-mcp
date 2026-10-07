import { loadCostTable } from "./billing/costs.js";
import { PartnerApiClient } from "./client/partner-client.js";
import type { CoreConfig } from "./config.js";
import { ConcurrencyLimiter, CONNECTION_CONCURRENCY, MemoryRateLimitStore, type RateLimitStore } from "./limits/rate-limit.js";
import type { Logger } from "./logging.js";
import type { CoreDeps } from "./tools/types.js";

export function createCoreDeps(
  config: CoreConfig,
  logger: Logger,
  overrides: { fetch?: typeof fetch; rateLimits?: RateLimitStore; env?: NodeJS.ProcessEnv } = {},
): CoreDeps {
  return {
    client: new PartnerApiClient({ baseUrl: config.BOLD_API_BASE_URL, timeoutMs: config.BOLD_API_TIMEOUT_MS, ...(overrides.fetch ? { fetch: overrides.fetch } : {}) }),
    costs: loadCostTable(overrides.env),
    rateLimits: overrides.rateLimits ?? new MemoryRateLimitStore(),
    concurrency: new ConcurrencyLimiter(CONNECTION_CONCURRENCY),
    logger,
  };
}
