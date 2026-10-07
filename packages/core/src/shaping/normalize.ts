/**
 * Response normalisers shared by every tool (brief: "Response shaping").
 * - `""`, `"-"` and `null` become `null`
 * - numeric strings become numbers, except identifiers and codes
 * - dates become ISO `YYYY-MM-DD` (including `bydate` `YYYYMMDD`)
 * - Chinese-label fields (`*_cn`) are dropped unless language is "zh"
 * - free text is truncated to 200 characters
 */

export type Scalar = string | number | boolean | null;
export type Language = "en" | "zh";

export const TEXT_LIMIT = 200;
const EMPTY = new Set(["", "-", "--", "n/a", "N/A", "null", "NULL"]);
const NUMERIC = /^-?\d+(\.\d+)?$/;

/** Keys whose values are identifiers or codes and must stay strings even when numeric. */
export function isIdentifierKey(key: string): boolean {
  return (
    key === "id" ||
    key === "value" ||
    key === "label" ||
    /(^|_)(id|ids|code|codes|nbr|nbrs|number|phone|phones|zip|postcode|postal_code|year|naics|sitc|hs)$/.test(key) ||
    key.startsWith("hs_")
  );
}

export function isChineseKey(key: string): boolean {
  return key.endsWith("_cn") || key === "cn";
}

export function nullIfEmpty(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" && EMPTY.has(value.trim())) return null;
  return value;
}

export function toNumber(value: unknown): number | null {
  const v = nullIfEmpty(value);
  if (v === null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const s = v.trim().replace(/,/g, "");
    return NUMERIC.test(s) ? Number(s) : null;
  }
  return null;
}

export function toStr(value: unknown): string | null {
  const v = nullIfEmpty(value);
  if (v === null) return null;
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return null;
}

export function toBool(value: unknown): boolean | null {
  const v = nullIfEmpty(value);
  if (typeof v === "boolean") return v;
  if (v === 1 || v === "1" || v === "true" || v === "yes" || v === "Yes") return true;
  if (v === 0 || v === "0" || v === "false" || v === "no" || v === "No") return false;
  return null;
}

/** `YYYYMMDD`, `YYYY-MM-DD`, `YYYY-MM-DD HH:mm:ss`, `YYYY/MM/DD` → `YYYY-MM-DD`. Anything else → null. */
export function toIsoDate(value: unknown): string | null {
  const s = toStr(value);
  if (!s) return null;
  let m = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (!m) m = /^(\d{4})[-/](\d{2})[-/](\d{2})(?:[ T].*)?$/.exec(s);
  if (!m) return null;
  const [, y, mo, d] = m;
  return `${y}-${mo}-${d}`;
}

/** `YYYY-MM-DD HH:mm:ss` → ISO 8601 (UTC assumed when no offset). Falls back to the date only. */
export function toIsoDateTime(value: unknown): string | null {
  const s = toStr(value);
  if (!s) return null;
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)(\.\d+)?(Z|[+-]\d{2}:?\d{2})?$/.exec(s);
  if (m) return `${m[1]}T${m[2]}${m[2]?.length === 5 ? ":00" : ""}${m[4] ?? "Z"}`;
  return toIsoDate(s);
}

export function truncate(text: string | null, limit = TEXT_LIMIT): { text: string | null; truncated: boolean } {
  if (text === null || text.length <= limit) return { text, truncated: false };
  return { text: `${text.slice(0, limit - 1).trimEnd()}…`, truncated: true };
}

/**
 * Normalise an object whose shape is not pinned down (nested rows such as
 * top-10 country lists). Scalars only: nested objects/arrays are flattened out.
 */
export function normalizeFlat(row: unknown, language: Language = "en"): Record<string, Scalar> {
  const out: Record<string, Scalar> = {};
  if (!row || typeof row !== "object" || Array.isArray(row)) return out;
  for (const [key, raw] of Object.entries(row as Record<string, unknown>)) {
    if (language !== "zh" && isChineseKey(key)) continue;
    const v = nullIfEmpty(raw);
    if (v === null) out[key] = null;
    else if (typeof v === "boolean") out[key] = v;
    else if (typeof v === "number") out[key] = Number.isFinite(v) ? v : null;
    else if (typeof v === "string") {
      if (/(^|_)date$|^bydate$/.test(key)) out[key] = toIsoDate(v) ?? v;
      else if (!isIdentifierKey(key) && NUMERIC.test(v.trim().replace(/,/g, ""))) out[key] = toNumber(v);
      else out[key] = v.trim();
    }
  }
  return out;
}

/** Rows from a list payload: a bare array, or the first array inside an object (`list`, `data`, `records`, …). */
export function extractRows(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    for (const k of ["list", "data", "records", "rows", "results", "items"]) {
      if (Array.isArray(obj[k])) return obj[k];
    }
    const first = Object.values(obj).find(Array.isArray);
    if (first) return first;
  }
  return [];
}

/** Total count from a list payload, when the API gives one. */
export function extractTotal(data: unknown): number | null {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>;
    for (const k of ["total", "total_records", "total_count", "count", "totalCount"]) {
      const n = toNumber(obj[k]);
      if (n !== null) return n;
    }
  }
  return null;
}

export interface PageInfo {
  total: number | null;
  page_no: number;
  page_size: number;
  has_more: boolean;
}

export function pageInfo(data: unknown, rowsReturned: number, pageNo: number, pageSize: number): PageInfo {
  const total = extractTotal(data);
  const has_more = total !== null ? pageNo * pageSize < total : rowsReturned >= pageSize;
  return { total, page_no: pageNo, page_size: pageSize, has_more };
}
