import { compact, SOURCE } from "../schemas/common.js";
import { findCompanyContactsInput, findCompanyContactsOutput } from "../schemas/find_company_contacts.js";
import { extractRows, normalizeFlat, pageInfo, toBool, toNumber, toStr } from "../shaping/normalize.js";
import { defineTool, FREE_READ_ONLY } from "./types.js";

/**
 * Which details exist, as counts. The live teaser has `*_count` fields next to
 * arrays of email domains; only the counts (and the premium-phone flag) are kept.
 */
function available(teaser: unknown): Record<string, number | boolean | null> {
  const t = (teaser ?? {}) as Record<string, unknown>;
  if (!("professional_emails_count" in t || "phones_count" in t || "personal_emails_count" in t)) return normalizeFlat(t) as Record<string, number | boolean | null>;
  const out: Record<string, number | boolean | null> = {
    professional_emails: toNumber(t.professional_emails_count),
    personal_emails: toNumber(t.personal_emails_count),
    phones: toNumber(t.phones_count),
  };
  const premium = toBool(t.is_premium_phone_available);
  if (premium !== null) out.premium_phone_available = premium;
  return out;
}

// Not idempotent: Pro mode spends contact credits on every call (brief).
const ANNOTATIONS = { ...FREE_READ_ONLY, idempotentHint: false, title: "Find company contacts" };

export const findCompanyContacts = defineTool({
  name: "find_company_contacts",
  title: "Find company contacts",
  description: [
    "Free in Lite mode (10 calls a minute, 150 an hour). Pro mode (volume=\"pro\") costs 2 contact credits per page.",
    "Lists people at a company as masked previews: contact_id, name, position, country, LinkedIn URL and which emails or phones exist. Never shows full emails or phones.",
    "Needs company_id with type (from find_company_id) or company_name. Filter with roles. To unlock details for one person, use reveal_contact_details with the contact_id, only if the user asks.",
  ].join("\n"),
  inputSchema: findCompanyContactsInput,
  outputSchema: findCompanyContactsOutput,
  annotations: ANNOTATIONS,
  endpoints: ["company-contacts", "advanced-company-contacts"],
  paid: true,
  async handler(args, rt) {
    const body = compact({
      company_id: args.company_id,
      type: args.company_id ? args.type : undefined,
      company_name: args.company_id ? undefined : args.company_name,
      roles: args.roles,
      page_size: args.page_size,
      page_no: args.page_no,
    });
    const pro = args.volume === "pro";
    const data = await rt.call(pro ? "advanced-company-contacts" : "company-contacts", body);
    const raw = extractRows(data);
    const rows = raw
      .map((r) => {
        const o = (r ?? {}) as Record<string, unknown>;
        return {
          contact_id: toStr(o.id ?? o.contact_id),
          name: toStr(o.name),
          position: toStr(o.position),
          company: toStr(o.company),
          country_code: toStr(o.country_code),
          linkedin_url: toStr(o.linkedin_url),
          available: available(o.teaser),
        };
      })
      .filter((r): r is typeof r & { contact_id: string } => r.contact_id !== null);
    const page = pageInfo(data, rows.length, args.page_no, args.page_size);
    return {
      structured: { source: SOURCE, status: "ok" as const, pool: pro ? ("contact" as const) : null, mode: args.volume, rows, ...page, next_page_cost_credits: pro ? 2 : 0 },
      summary: `${rows.length} contact preview${rows.length === 1 ? "" : "s"} (details masked). Source: Bill of Lading Data.`,
      billing: { units: pro && raw.length > 0 ? 1 : 0 },
    };
  },
});
