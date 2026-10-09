import { SOURCE } from "../schemas/common.js";
import { checkLogisticsCompanyInput, checkLogisticsCompanyOutput } from "../schemas/check_logistics_company.js";
import { toBool } from "../shaping/normalize.js";
import { defineTool, FREE_READ_ONLY } from "./types.js";

export const checkLogisticsCompany = defineTool({
  name: "check_logistics_company",
  title: "Check logistics company",
  description: [
    "Free (no credits).",
    "Checks whether a buyer or supplier is really a freight forwarder or logistics company. Call it before paying for a company profile or contacts.",
    "Needs a company_id from find_company_id or a ranked list.",
  ].join("\n"),
  inputSchema: checkLogisticsCompanyInput,
  outputSchema: checkLogisticsCompanyOutput,
  annotations: { ...FREE_READ_ONLY, title: "Check logistics company" },
  endpoints: ["check-logistic-company"],
  async handler(args, rt) {
    const data = await rt.call("check-logistic-company", { type: args.type, company_id: args.company_id });
    const value = data && typeof data === "object" ? (data as Record<string, unknown>).is_logistics_company : data;
    const is_logistics_company = toBool(value);
    return {
      structured: { source: SOURCE, company_id: args.company_id, is_logistics_company },
      summary:
        is_logistics_company === null
          ? "The logistics status of this company is unknown."
          : `This company ${is_logistics_company ? "is" : "is not"} a logistics company. Source: Bill of Lading Data.`,
    };
  },
});
