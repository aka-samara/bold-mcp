import { SOURCE } from "../schemas/common.js";
import { getCompanyProfileInput, getCompanyProfileOutput } from "../schemas/get_company_profile.js";
import { normalizeFlat, toBool, toCountry, toCountryList, toStr, toStrArray, toStrList } from "../shaping/normalize.js";
import { defineTool, PAID_READ_ONLY } from "./types.js";

const TOTAL_KEY = /^(total_|no_of_|number_of_)/;

export const getCompanyProfile = defineTool({
  name: "get_company_profile",
  title: "Get company profile",
  description: [
    "Costs 20 data credits per company.",
    "Full profile of one company: name, country, domain, tags, company contact info, social links, trade totals, trading countries and ports, industry classifications (HS, NAICS, SITC) and whether it is a logistics company.",
    "Needs company_id and type from find_company_id (free). Run check_logistics_company (free) first if you only need to rule out freight forwarders.",
  ].join("\n"),
  inputSchema: getCompanyProfileInput,
  outputSchema: getCompanyProfileOutput,
  annotations: { ...PAID_READ_ONLY, title: "Get company profile" },
  endpoints: ["company-details"],
  paid: true,
  async handler(args, rt) {
    const data = await rt.call("company-details", { type: args.type, company_id: args.company_id });
    const o = (data && typeof data === "object" && !Array.isArray(data) ? data : {}) as Record<string, unknown>;
    const found = Object.keys(o).length > 0;
    const flat = normalizeFlat(o);
    const ic = (o.industry_classifications ?? {}) as Record<string, unknown>;
    const profile = found
      ? {
          company_id: toStr(o.id ?? o.company_id) ?? args.company_id,
          name: toStr(o.name),
          country: toCountry(o.country),
          domain: toStr(o.domain),
          tags: toStrArray(o.tags),
          contact_info: normalizeFlat(o.contact_info),
          social_links: normalizeFlat(o.social_links),
          totals: Object.fromEntries(Object.entries(flat).filter(([k]) => TOTAL_KEY.test(k))),
          countries: toCountryList(o.countries, o.import_countries, o.export_countries),
          ports: toStrList(o.ports, o.loading_ports, o.unloading_ports),
          industry_classifications: { hs: toStrArray(ic.hs ?? ic.hs_codes), naics: toStrArray(ic.naics ?? ic.naics_codes), sitc: toStrArray(ic.sitc ?? ic.sitc_codes) },
          is_logistics_company: toBool(o.is_logistics_company),
        }
      : null;
    return {
      structured: { source: SOURCE, status: "ok" as const, pool: "data" as const, profile },
      summary: profile ? "Company profile returned. Source: Bill of Lading Data." : "No profile was returned for that company_id.",
      billing: { units: found ? 1 : 0 },
    };
  },
});
