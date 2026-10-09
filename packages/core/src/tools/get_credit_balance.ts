import { SOURCE } from "../schemas/common.js";
import { getCreditBalanceInput, getCreditBalanceOutput } from "../schemas/get_credit_balance.js";
import { parseCreditUsage, type PoolBalance } from "../shaping/credits.js";
import { defineTool, FREE_READ_ONLY } from "./types.js";

const fmt = (p: PoolBalance) => (p.remaining === null ? "unknown" : `${p.remaining.toLocaleString("en-US")}${p.total !== null ? ` of ${p.total.toLocaleString("en-US")}` : ""}`);

export const getCreditBalance = defineTool({
  name: "get_credit_balance",
  title: "Get credit balance",
  description: [
    "Free (no credits).",
    "Shows the account's three credit pools: data credits (shipments, company lists and profiles), contact credits (contact unlocks, Pro contact lists) and KYB credits (registry data), each with total, used and remaining.",
  ].join("\n"),
  inputSchema: getCreditBalanceInput,
  outputSchema: getCreditBalanceOutput,
  annotations: { ...FREE_READ_ONLY, title: "Get credit balance" },
  endpoints: ["credit-usage"],
  async handler(_args, rt) {
    const { balances, usage } = parseCreditUsage(await rt.call("credit-usage", {}));
    return {
      structured: { source: SOURCE, data_credits: balances.data, contact_credits: balances.contact, kyb_credits: balances.kyb, usage },
      summary: `Credits remaining: data ${fmt(balances.data)}, contact ${fmt(balances.contact)}, KYB ${fmt(balances.kyb)}.`,
    };
  },
});
