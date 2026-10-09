import type { EndpointPath } from "../client/endpoints.js";
import { PartnerApiError, toolErrorMessage } from "../client/errors.js";
import { SOURCE } from "../schemas/common.js";
import { getKybReportInput, getKybReportOutput, KYB_SECTIONS } from "../schemas/get_kyb_report.js";
import { reshapeFinancials, shapeOfficer } from "../shaping/kyb.js";
import { extractRows, normalizeFlat, pageInfo } from "../shaping/normalize.js";
import { defineTool, UNLOCK_ANNOTATIONS } from "./types.js";

type Section = (typeof KYB_SECTIONS)[number];

const PATH: Record<Section, EndpointPath> = {
  details: "advanced-kyb-search",
  financials: "financial-kyb",
  shareholders: "shareholders-kyb",
  officers: "officers-kyb",
};

export const getKybReport = defineTool({
  name: "get_kyb_report",
  title: "Get KYB report",
  description: [
    "Costs 10 KYB credits per section, only for sections that return data.",
    "Unlocks a company's registry report: details (registration, status, incorporation date, address, legal form, website, ticker), financials (one table per statement, a column per year), shareholders and officers. Always asks the user to confirm first.",
    "Call only when the user asked for KYB information. Get kyb_id from search_kyb and request only the sections the user needs.",
  ].join("\n"),
  inputSchema: getKybReportInput,
  outputSchema: getKybReportOutput,
  annotations: { ...UNLOCK_ANNOTATIONS, title: "Get KYB report" },
  endpoints: ["advanced-kyb-search", "financial-kyb", "shareholders-kyb", "officers-kyb"],
  paid: true,
  unlock: true,
  async handler(args, rt) {
    const out: { details?: Record<string, unknown> | null; financials?: ReturnType<typeof reshapeFinancials> | null; shareholders?: unknown; officers?: unknown } = {};
    const returned: Section[] = [];
    const errors: Record<string, string> = {};
    let firstError: unknown;
    const paging = { page_size: args.page_size, page_no: args.page_no };

    // Requested order is kept; one failing section does not lose the others.
    for (const section of KYB_SECTIONS.filter((s) => args.sections.includes(s))) {
      const paged = section === "shareholders" || section === "officers";
      let data: unknown;
      try {
        data = await rt.call(PATH[section], { kyb_id: args.kyb_id, ...(paged ? paging : {}) });
      } catch (err) {
        if (!(err instanceof PartnerApiError) || err.kind === "unauthorized") throw err;
        firstError ??= err;
        errors[section] = toolErrorMessage(err, "KYB");
        out[section] = null;
        continue;
      }
      if (section === "details") {
        const d = data && typeof data === "object" && !Array.isArray(data) ? normalizeFlat(data) : {};
        out.details = Object.keys(d).length ? d : null;
      } else if (section === "financials") {
        const t = reshapeFinancials(data);
        out.financials = t.length ? t : null;
      } else {
        const raw = extractRows(data);
        const rows = raw.map((r) => (section === "officers" ? shapeOfficer(r) : normalizeFlat(r)));
        out[section] = rows.length ? { rows, ...pageInfo(data, rows.length, args.page_no, args.page_size) } : null;
      }
      if (out[section]) returned.push(section);
    }
    if (returned.length === 0 && firstError) throw firstError;

    const failed = Object.keys(errors);
    return {
      structured: {
        source: SOURCE,
        status: "ok" as const,
        pool: "kyb" as const,
        kyb_id: args.kyb_id,
        ...(out as Record<string, never>),
        returned_sections: returned,
        ...(failed.length ? { section_errors: errors } : {}),
      },
      summary:
        (returned.length ? `KYB sections returned: ${returned.join(", ")}.` : "No KYB data was returned, so nothing was charged.") +
        (failed.length ? ` Failed (not charged): ${failed.join(", ")}.` : "") +
        " Source: Bill of Lading Data.",
      billing: { units: returned.length },
      ...(returned.length ? { audit: { subject_type: "kyb" as const, subject_id: args.kyb_id, unlocked: [...returned] } } : {}),
    };
  },
});
