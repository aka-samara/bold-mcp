import { isChineseKey, toNumber, toStr, type Language } from "./normalize.js";

export const OPTION_LIMIT = 100;

export interface LabelValueOut {
  label: string | null;
  value: string | null;
  label_cn?: string | null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

export function optionList(raw: unknown, language: Language, limit = OPTION_LIMIT) {
  const all = asArray(raw);
  const items = all.slice(0, limit).map((o): LabelValueOut => {
    if (typeof o === "string" || typeof o === "number") return { label: String(o), value: String(o) };
    const r = (o ?? {}) as Record<string, unknown>;
    const out: LabelValueOut = { label: toStr(r.label), value: toStr(r.value) };
    if (language === "zh") out.label_cn = toStr(r.label_cn);
    return out;
  });
  return { items, total: all.length, truncated: all.length > limit };
}

export function nameList(raw: unknown, limit = OPTION_LIMIT) {
  const all = asArray(raw)
    .map((v) => (typeof v === "object" && v !== null ? toStr((v as Record<string, unknown>).value ?? (v as Record<string, unknown>).label) : toStr(v)))
    .filter((v): v is string => v !== null);
  return { items: all.slice(0, limit), total: all.length, truncated: all.length > limit };
}

export function range(raw: unknown): { min: number | null; max: number | null } | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  return { min: toNumber(r.min), max: toNumber(r.max) };
}

/** `quantities` / `weights`: an array of `{unit, min, max}` or an object keyed by unit. */
export function unitRanges(raw: unknown): { unit: string | null; min: number | null; max: number | null }[] {
  if (Array.isArray(raw)) {
    return raw.map((r) => {
      const o = (r ?? {}) as Record<string, unknown>;
      return { unit: toStr(o.unit ?? o.label), min: toNumber(o.min), max: toNumber(o.max) };
    });
  }
  if (raw && typeof raw === "object") {
    return Object.entries(raw as Record<string, unknown>)
      .filter(([k]) => !isChineseKey(k))
      .map(([unit, v]) => {
        const o = (v ?? {}) as Record<string, unknown>;
        return { unit, min: toNumber(o.min), max: toNumber(o.max) };
      });
  }
  return [];
}
