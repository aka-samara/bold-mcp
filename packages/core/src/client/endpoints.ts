/**
 * Catalogue of the 22 global Partner API endpoint paths (16 documentation tabs).
 *
 * This is the single list the client, fixtures and contract tests are checked
 * against. Prices here are descriptive only: the credit maths used by the
 * credit guard lives in `billing/costs.ts` (M2), which is loaded from config.
 */

export type CreditPool = "data" | "contact" | "kyb";

/** How the Partner API charges for a call. */
export type ChargeUnit =
  | "free"
  | "per_record" // each record returned
  | "per_page" // each non-empty page returned (Contacts Pro)
  | "per_request" // each successful request (KYB)
  | "per_person_lookup"; // per person, per lookup type returned (Contact Look Up)

export interface RateLimit {
  perMinute?: number;
  perHour?: number;
  perDay?: number;
  perMonth?: number;
}

export interface EndpointSpec {
  /** Path under the base URL, without a leading slash. */
  path: string;
  /** Documentation tab, e.g. "8a". */
  tab: string;
  title: string;
  charge: ChargeUnit;
  pool: CreditPool | null;
  /** Documented unit price; for per_person_lookup see `lookupPrices`. */
  unitCredits: number;
  maxPageSize: number | null;
  rateLimit: RateLimit | null;
}

export const ENDPOINTS = [
  { path: "search-filters", tab: "1", title: "Search Filters", charge: "free", pool: null, unitCredits: 0, maxPageSize: null, rateLimit: null },
  { path: "shipping-filters", tab: "2", title: "Shipping Filters", charge: "free", pool: null, unitCredits: 0, maxPageSize: null, rateLimit: null },
  { path: "insights", tab: "3", title: "Insights", charge: "free", pool: null, unitCredits: 0, maxPageSize: null, rateLimit: null },
  { path: "shipping-records", tab: "4", title: "Shipping Records", charge: "per_record", pool: "data", unitCredits: 1, maxPageSize: 250, rateLimit: null },
  { path: "all-importers", tab: "5", title: "All Importers", charge: "per_record", pool: "data", unitCredits: 15, maxPageSize: 250, rateLimit: null },
  { path: "all-exporters", tab: "6", title: "All Exporters", charge: "per_record", pool: "data", unitCredits: 15, maxPageSize: 250, rateLimit: null },
  { path: "company-details", tab: "7", title: "Company Details", charge: "per_record", pool: "data", unitCredits: 20, maxPageSize: null, rateLimit: null },
  { path: "company-search-free", tab: "8a", title: "Company Search — Free", charge: "free", pool: null, unitCredits: 0, maxPageSize: 250, rateLimit: { perMinute: 30, perHour: 450, perDay: 1500 } },
  { path: "company-search", tab: "8b", title: "Company Search — Advanced", charge: "per_record", pool: "data", unitCredits: 15, maxPageSize: 250, rateLimit: null },
  { path: "company-contacts", tab: "9a", title: "Company Contacts — Lite", charge: "free", pool: null, unitCredits: 0, maxPageSize: 250, rateLimit: { perMinute: 10, perHour: 150, perMonth: 25000 } },
  { path: "advanced-company-contacts", tab: "9b", title: "Company Contacts — Pro", charge: "per_page", pool: "contact", unitCredits: 2, maxPageSize: 50, rateLimit: { perMinute: 75, perHour: 500, perMonth: 150000 } },
  { path: "contact-look-up", tab: "10", title: "Contact Look Up", charge: "per_person_lookup", pool: "contact", unitCredits: 15, maxPageSize: null, rateLimit: null },
  { path: "check-logistic-company", tab: "11", title: "Check Logistic Company", charge: "free", pool: null, unitCredits: 0, maxPageSize: null, rateLimit: null },
  { path: "competitors", tab: "12", title: "Competitors", charge: "per_record", pool: "data", unitCredits: 15, maxPageSize: 250, rateLimit: null },
  { path: "products", tab: "13", title: "Products", charge: "free", pool: null, unitCredits: 0, maxPageSize: 250, rateLimit: null },
  { path: "kyb-search", tab: "14a", title: "KYB — Search", charge: "per_request", pool: "kyb", unitCredits: 3, maxPageSize: null, rateLimit: null },
  { path: "advanced-kyb-search", tab: "14b", title: "KYB — Details", charge: "per_request", pool: "kyb", unitCredits: 10, maxPageSize: null, rateLimit: null },
  { path: "financial-kyb", tab: "14c", title: "KYB — Financial", charge: "per_request", pool: "kyb", unitCredits: 10, maxPageSize: null, rateLimit: null },
  { path: "shareholders-kyb", tab: "14d", title: "KYB — Shareholders", charge: "per_request", pool: "kyb", unitCredits: 10, maxPageSize: 100, rateLimit: null },
  { path: "officers-kyb", tab: "14e", title: "KYB — Officers", charge: "per_request", pool: "kyb", unitCredits: 10, maxPageSize: 100, rateLimit: null },
  { path: "credit-usage", tab: "15", title: "Credit Usage", charge: "free", pool: null, unitCredits: 0, maxPageSize: null, rateLimit: null },
  { path: "credit-usage-logs", tab: "16", title: "Credit Usage Logs", charge: "free", pool: null, unitCredits: 0, maxPageSize: 250, rateLimit: null },
] as const satisfies readonly EndpointSpec[];

export type EndpointPath = (typeof ENDPOINTS)[number]["path"];

/** Contact Look Up prices per person, per lookup type returned. */
export const CONTACT_LOOKUP_PRICES = {
  professional_emails: 10,
  personal_emails: 10,
  phones: 15,
} as const;

const byPath = new Map<string, EndpointSpec>(ENDPOINTS.map((e) => [e.path, e]));

export function getEndpoint(path: EndpointPath): EndpointSpec {
  const spec = byPath.get(path);
  if (!spec) throw new Error(`Unknown endpoint path: ${path}`);
  return spec;
}

export function isEndpointPath(value: string): value is EndpointPath {
  return byPath.has(value);
}
