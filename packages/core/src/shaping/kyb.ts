import { normalizeFlat, nullIfEmpty, toNumber, toStr, type Scalar } from "./normalize.js";

/** Officer fields that identify a person's birth date; never returned (brief). */
const DOB_KEY = /(^|_)(dob|date_of_birth|birth_date|birthdate|birth_month|birth_year|birthday)$/i;

/** Officer row without date-of-birth fields. */
export function shapeOfficer(row: unknown): Record<string, Scalar> {
  return Object.fromEntries(Object.entries(normalizeFlat(row)).filter(([k]) => !DOB_KEY.test(k)));
}

export interface FinancialTable {
  group: string;
  years: string[];
  rows: Record<string, Scalar>[];
}

/**
 * Financial KYB comes as `years[]` and `groups[]` of line items with values
 * keyed by year. Reshape into one table per group with a column per year
 * (brief: "Response shaping").
 */
export function reshapeFinancials(data: unknown): FinancialTable[] {
  if (!data || typeof data !== "object" || Array.isArray(data)) return [];
  const o = data as Record<string, unknown>;
  const years = (Array.isArray(o.years) ? o.years : []).map((y) => toStr(y)).filter((y): y is string => y !== null);
  const groups = Array.isArray(o.groups) ? o.groups : [];
  return groups
    .map((g) => {
      const go = (g ?? {}) as Record<string, unknown>;
      const items = Array.isArray(go.items) ? go.items : Array.isArray(go.rows) ? go.rows : [];
      const rows = items.map((it) => {
        const io = (it ?? {}) as Record<string, unknown>;
        const values = (io.values && typeof io.values === "object" ? io.values : {}) as Record<string, unknown>;
        const row: Record<string, Scalar> = { item: toStr(io.name ?? io.label ?? io.item) };
        for (const y of years) {
          const v = nullIfEmpty(values[y]);
          row[y] = v === null ? null : (toNumber(v) ?? toStr(v));
        }
        return row;
      });
      return { group: toStr(go.name ?? go.group ?? go.label) ?? "Other", years, rows };
    })
    .filter((t) => t.rows.length > 0);
}
