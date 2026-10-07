import { compact, SOURCE } from "../schemas/common.js";
import { findCompanyContactsInput, findCompanyContactsOutput } from "../schemas/find_company_contacts.js";
import { extractRows, normalizeFlat, pageInfo, toStr } from "../shaping/normalize.js";
import { defineTool, FREE_READ_ONLY } from "./types.js";

export const findCompanyContacts = defineTool({
  name: "find_company_contacts",
  title: "Find company contacts",
  description: [
    "Free (no credits; limited to 10 calls a minute, 150 an hour).",
    "Lists people at a company as masked previews: contact_id, name, position, country, LinkedIn URL and which emails or phones exist. Never shows full emails or phones.",
    "Needs company_id with type (from find_company_id) or company_name. Filter with roles. To unlock details for one person, use reveal_contact_details with the contact_id, only if the user asks.",
  ].join("\n"),
  inputSchema: findCompanyContactsInput,
  outputSchema: findCompanyContactsOutput,
  annotations: { ...FREE_READ_ONLY, title: "Find company contacts" },
  endpoints: ["company-contacts"],
  async handler(args, rt) {
    const body = compact({
      company_id: args.company_id,
      type: args.company_id ? args.type : undefined,
      company_name: args.company_id ? undefined : args.company_name,
      roles: args.roles,
      page_size: args.page_size,
      page_no: args.page_no,
    });
    const data = await rt.call("company-contacts", body);
    const rows = extractRows(data)
      .map((r) => {
        const o = (r ?? {}) as Record<string, unknown>;
        return {
          contact_id: toStr(o.id ?? o.contact_id),
          name: toStr(o.name),
          position: toStr(o.position),
          company: toStr(o.company),
          country_code: toStr(o.country_code),
          linkedin_url: toStr(o.linkedin_url),
          available: normalizeFlat(o.teaser),
        };
      })
      .filter((r): r is typeof r & { contact_id: string } => r.contact_id !== null);
    const page = pageInfo(data, rows.length, args.page_no, args.page_size);
    return {
      structured: { source: SOURCE, mode: "lite" as const, rows, ...page, next_page_cost_credits: 0 },
      summary: `${rows.length} contact preview${rows.length === 1 ? "" : "s"} (details masked). Source: Bill of Lading Data.`,
    };
  },
});
