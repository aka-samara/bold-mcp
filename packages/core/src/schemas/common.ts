import { z } from "zod";

export const TRANSPORT_TYPES = ["sea", "land", "air", "postal", "railway", "pipeline", "power transmission", "other"] as const;
export const CONTACT_ROLES = ["All", "Founder", "Chairman", "Chief", "Vice President", "Director", "Manager"] as const;

export const TradeType = z.enum(["imp", "exp"]).describe('"imp" for import data, "exp" for export data');
export const CountryCode = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{2}$/, "must be a 2-letter ISO country code")
  .transform((s) => s.toUpperCase());
export const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD");
export const CompanyId = z.string().trim().min(1).max(200).describe("company_id from find_company_id or a ranked list. Not a shipment import_id/export_id.");
export const HsCode = z.string().trim().regex(/^\d{2,10}$/, "HS codes are 2–10 digits");
export const Language = z.enum(["en", "zh"]).default("en").describe('"zh" keeps Chinese labels');

const MAX_MONTHS = 12;

/** True when end is no more than 12 calendar months after start. */
export function withinTwelveMonths(start: string, end: string): boolean {
  const s = new Date(`${start}T00:00:00Z`);
  const limit = new Date(s);
  limit.setUTCMonth(limit.getUTCMonth() + MAX_MONTHS);
  return new Date(`${end}T00:00:00Z`) <= limit;
}

export const DateRange = z
  .object({ start_date: IsoDate, end_date: IsoDate })
  .superRefine((r, ctx) => {
    const s = Date.parse(`${r.start_date}T00:00:00Z`);
    const e = Date.parse(`${r.end_date}T00:00:00Z`);
    if (Number.isNaN(s)) ctx.addIssue({ code: "custom", path: ["start_date"], message: "is not a valid date" });
    if (Number.isNaN(e)) ctx.addIssue({ code: "custom", path: ["end_date"], message: "is not a valid date" });
    if (Number.isNaN(s) || Number.isNaN(e)) return;
    if (e < s) ctx.addIssue({ code: "custom", path: ["end_date"], message: "must be on or after start_date" });
    else if (!withinTwelveMonths(r.start_date, r.end_date)) ctx.addIssue({ code: "custom", message: "date_range exceeds 12 months" });
  })
  .describe("At most 12 months. Defaults to the last 12 months.");

const MinMax = { min: z.number().optional(), max: z.number().optional() };
export const ValueRange = z.object(MinMax).describe("Value range in USD");
export const UnitRange = z.object({ unit: z.string().min(1).describe("Unit, as listed by get_filter_options"), ...MinMax });

/** Fields of the brief's shared `TradeFilter` input. */
export const tradeFilterShape = {
  type: TradeType,
  hs_codes: z.array(HsCode).min(1).max(20).optional().describe("HS codes (use get_filter_options or search_products to find them)"),
  products: z.array(z.string().trim().min(2).max(100)).min(1).max(10).optional().describe("Product keywords"),
  company_id: CompanyId.optional(),
  date_range: DateRange.optional(),
  import_countries: z.array(CountryCode).max(50).optional().describe("2-letter ISO codes of importing countries"),
  export_countries: z.array(CountryCode).max(50).optional().describe("2-letter ISO codes of exporting countries"),
  import_value: ValueRange.optional(),
  weight: UnitRange.optional(),
  transport_types: z.array(z.enum(TRANSPORT_TYPES)).max(8).optional(),
};

/** Server-side check the brief requires before calling the API. */
export function requireSubject(v: { hs_codes?: unknown[] | undefined; products?: unknown[] | undefined; company_id?: string | undefined }, ctx: z.RefinementCtx): void {
  if (!v.hs_codes?.length && !v.products?.length && !v.company_id) {
    ctx.addIssue({ code: "custom", message: "Give at least one of hs_codes, products or company_id" });
  }
}

export function pageSize(defaultSize: number, max: number) {
  return z.number().int().min(1).max(max).default(defaultSize).describe(`Results per page (default ${defaultSize}, max ${max})`);
}
export const PageNo = z.number().int().min(1).max(10_000).default(1).describe("Page number, from 1");

/** Drop undefined values so the API never sees `"key": undefined`. */
export function compact<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && !(Array.isArray(v) && v.length === 0)));
}

// ---- Output building blocks -------------------------------------------------

export const SOURCE = "Bill of Lading Data" as const;
export const Source = z.literal(SOURCE);
export const ScalarValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export const FlatRecord = z.record(z.string(), ScalarValue);

export const pageOutputShape = {
  total: z.number().nullable().describe("Total matching records, when the API reports it"),
  page_no: z.number(),
  page_size: z.number(),
  has_more: z.boolean(),
  next_page_cost_credits: z.number().describe("Worst-case credits for the next page (0 for free tools)"),
};

export const LabelValue = z.object({ label: z.string().nullable(), value: z.string().nullable(), label_cn: z.string().nullable().optional() });
export const Range = z.object({ min: z.number().nullable(), max: z.number().nullable() });
export const UnitRangeOut = z.object({ unit: z.string().nullable(), min: z.number().nullable(), max: z.number().nullable() });

// ---- Paid tools ---------------------------------------------------------------

/** Inputs every paid tool takes (brief: optional max_credits and confirmation_token). */
export const paidInputShape = {
  max_credits: z.number().int().min(0).optional().describe("Optional cap for this call; above it the user is asked to confirm"),
  confirmation_token: z.string().max(2000).optional().describe("From a previous confirmation_required result, after the user agreed"),
};

export const ConfirmationInfo = z.object({
  message: z.string(),
  reasons: z.array(z.string()),
  pool: z.enum(["data", "contact", "kyb"]),
  estimated_max_credits: z.number(),
  pool_remaining: z.number().nullable(),
  confirmation_token: z.string().describe("Pass back unchanged with the same arguments once the user agrees"),
  expires_at: z.string(),
});

export const creditOutputShape = {
  status: z.enum(["ok", "confirmation_required", "cancelled"]).describe('"confirmation_required": ask the user, then call again with confirmation_token'),
  pool: z.enum(["data", "contact", "kyb"]).nullable().describe("Credit pool this call charges"),
  credits_used: z.number().optional().describe("Credits this call used, estimated from what was returned"),
  credits_used_is_estimate: z.boolean().optional(),
  credits_remaining: z.number().nullable().optional().describe("Pool balance after the call"),
  confirmation: ConfirmationInfo.optional(),
};

/** Output for a tool that can spend credits: data fields are absent when confirmation is required. */
export function paidOutput<S extends z.ZodRawShape>(dataShape: S) {
  return z.object({ source: Source, ...creditOutputShape, ...z.object(dataShape).partial().shape });
}
