import type { CreditPool } from "../client/endpoints.js";
import type { SpendingSettings } from "../tools/types.js";
import { POOL_LABEL } from "./costs.js";
import type { Estimate } from "./estimator.js";

export type GuardDecision =
  | { action: "proceed" }
  | { action: "refuse"; message: string }
  | { action: "confirm"; reasons: string[] };

export interface GuardInput {
  estimate: Estimate & { pool: CreditPool };
  isUnlock: boolean;
  settings: SpendingSettings;
  /** Optional cap the AI passed as `max_credits`. */
  maxCreditsArg: number | undefined;
  spentToday: number;
  /** Pool's remaining balance from Credit Usage; null when unknown. */
  remaining: number | null;
}

/**
 * The credit guard's decision for one paid call (brief: "Before each paid
 * call"). Pure: no I/O, so every branch is unit-tested.
 */
export function decide(input: GuardInput): GuardDecision {
  const { estimate, isUnlock, settings, maxCreditsArg, spentToday, remaining } = input;
  const pool = estimate.pool;
  const label = POOL_LABEL[pool];

  if (isUnlock && pool === "contact" && !settings.allowContactUnlocks)
    return { action: "refuse", message: "Contact unlocks are turned off for this connection. The user can turn them on in their connection settings." };
  if (isUnlock && pool === "kyb" && !settings.allowKybUnlocks)
    return { action: "refuse", message: "KYB unlocks are turned off for this connection. The user can turn them on in their connection settings." };

  if (remaining !== null && estimate.max_credits > remaining) {
    return {
      action: "refuse",
      message:
        `Not enough ${label} credits — you have ${remaining.toLocaleString("en-US")} left and this call can use up to ${estimate.max_credits.toLocaleString("en-US")}.` +
        (estimate.basis.includes("record") ? " Try a smaller page_size." : " Top up at https://billofladingdata.com."),
    };
  }

  const reasons: string[] = [];
  if (isUnlock) reasons.push(`${pool === "contact" ? "Contact" : "KYB"} unlocks always need the user's confirmation.`);
  const limit = Math.min(settings.perCallLimit, maxCreditsArg ?? Number.POSITIVE_INFINITY);
  if (estimate.max_credits > limit) reasons.push(`This call can use up to ${estimate.max_credits} ${label} credits, above the per-call limit of ${limit}.`);
  if (spentToday + estimate.max_credits > settings.dailyLimit)
    reasons.push(`This call would take today's spending on this connection past its daily limit of ${settings.dailyLimit} credits (${spentToday} used so far).`);

  return reasons.length ? { action: "confirm", reasons } : { action: "proceed" };
}
