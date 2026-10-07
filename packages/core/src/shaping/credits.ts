import type { CreditPool } from "../client/endpoints.js";
import { normalizeFlat, toNumber } from "./normalize.js";

export interface PoolBalance {
  total: number | null;
  used: number | null;
  remaining: number | null;
}
export type Balances = Record<CreditPool, PoolBalance>;

const POOL_KEYS: Record<CreditPool, string[]> = {
  data: ["data_credits", "data"],
  contact: ["contact_credits", "contact"],
  kyb: ["kyb_credits", "kyb"],
};

function pool(raw: unknown): PoolBalance {
  const o = (raw ?? {}) as Record<string, unknown>;
  const total = toNumber(o.total);
  const used = toNumber(o.used);
  let remaining = toNumber(o.remaining);
  if (remaining === null && total !== null && used !== null) remaining = total - used;
  return { total, used, remaining };
}

/** Parse the Credit Usage payload into the three pools plus per-action usage counts. */
export function parseCreditUsage(data: unknown): { balances: Balances; usage: Record<string, string | number | boolean | null> } {
  const d = (data ?? {}) as Record<string, unknown>;
  const credits = (d.credits ?? d) as Record<string, unknown>;
  const pick = (p: CreditPool) => pool(POOL_KEYS[p].map((k) => credits[k]).find((v) => v !== undefined));
  return { balances: { data: pick("data"), contact: pick("contact"), kyb: pick("kyb") }, usage: normalizeFlat(d.usage) };
}
