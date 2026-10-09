import { SOURCE } from "../schemas/common.js";
import { LOOKUP_TYPES, revealContactDetailsInput, revealContactDetailsOutput } from "../schemas/reveal_contact_details.js";
import { toStr } from "../shaping/normalize.js";
import { defineTool, UNLOCK_ANNOTATIONS } from "./types.js";

type LookupType = (typeof LOOKUP_TYPES)[number];

function emails(v: unknown) {
  return (Array.isArray(v) ? v : [])
    .map((e) => (typeof e === "string" ? { email: e, verification: null } : { email: toStr((e as Record<string, unknown>)?.email), verification: toStr((e as Record<string, unknown>)?.verification ?? (e as Record<string, unknown>)?.grade) }))
    .filter((e): e is { email: string; verification: string | null } => e.email !== null);
}

function phones(v: unknown) {
  return (Array.isArray(v) ? v : [])
    .map((p) => (typeof p === "string" ? { phone: p, type: null } : { phone: toStr((p as Record<string, unknown>)?.phone ?? (p as Record<string, unknown>)?.number), type: toStr((p as Record<string, unknown>)?.type) }))
    .filter((p): p is { phone: string; type: string | null } => p.phone !== null);
}

export const revealContactDetails = defineTool({
  name: "reveal_contact_details",
  title: "Reveal contact details",
  description: [
    "Costs contact credits per person, only for what is returned: professional email 10, personal email 10, phone 15.",
    "Unlocks one person's verified emails and/or phone numbers. Always asks the user to confirm first.",
    "Call only when the user asked for this person's contact details. Get contact_id from find_company_contacts (free previews show which details exist) and request only the lookup types that exist.",
  ].join("\n"),
  inputSchema: revealContactDetailsInput,
  outputSchema: revealContactDetailsOutput,
  annotations: { ...UNLOCK_ANNOTATIONS, title: "Reveal contact details" },
  endpoints: ["contact-look-up"],
  paid: true,
  unlock: true,
  async handler(args, rt) {
    const data = await rt.call("contact-look-up", { contact_id: args.contact_id, lookup_type: args.lookup_type });
    const o = (data && typeof data === "object" && !Array.isArray(data) ? data : null) as Record<string, unknown> | null;
    // profile_pic is dropped (brief); only the requested types are kept.
    const want = new Set<LookupType>(args.lookup_type);
    const contact = o
      ? {
          contact_id: toStr(o.id ?? o.contact_id) ?? args.contact_id,
          name: toStr(o.name),
          position: toStr(o.position ?? o.title),
          company: toStr(o.company ?? o.company_name),
          country_code: toStr(o.country_code),
          linkedin_url: toStr(o.linkedin_url),
          professional_emails: want.has("professional_emails") ? emails(o.professional_emails) : [],
          personal_emails: want.has("personal_emails") ? emails(o.personal_emails) : [],
          phones: want.has("phones") ? phones(o.phones) : [],
        }
      : null;
    const returned = contact ? LOOKUP_TYPES.filter((t) => want.has(t) && contact[t].length > 0) : [];
    const parts = returned.map((t) => `${contact?.[t].length} ${t.replace("_", " ").replace(/s$/, "")}${(contact?.[t].length ?? 0) === 1 ? "" : "s"}`.replace("phone", "phone number"));
    return {
      structured: { source: SOURCE, status: "ok" as const, pool: "contact" as const, contact, returned_types: [...returned] },
      summary: returned.length ? `Unlocked ${parts.join(", ")}. Source: Bill of Lading Data.` : "Nothing was found for the requested details, so nothing was charged.",
      billing: { lookups: [...returned] },
      ...(returned.length ? { audit: { subject_type: "contact" as const, subject_id: args.contact_id, unlocked: [...returned] } } : {}),
    };
  },
});
