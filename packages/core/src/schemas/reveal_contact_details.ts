import { z } from "zod";
import { paidInputShape, paidOutput } from "./common.js";

export const LOOKUP_TYPES = ["professional_emails", "personal_emails", "phones"] as const;

export const revealContactDetailsInput = z.object({
  contact_id: z.string().trim().min(1).max(200).describe("contact_id from find_company_contacts"),
  lookup_type: z
    .array(z.enum(LOOKUP_TYPES))
    .min(1)
    .max(3)
    .refine((a) => new Set(a).size === a.length, "lookup_type values must be unique")
    .describe("What to unlock: professional_emails (10 credits), personal_emails (10), phones (15)"),
  ...paidInputShape,
});

export const RevealedEmail = z.object({ email: z.string(), verification: z.string().nullable() });
export const RevealedPhone = z.object({ phone: z.string(), type: z.string().nullable() });

export const RevealedContact = z.object({
  contact_id: z.string(),
  name: z.string().nullable(),
  position: z.string().nullable(),
  company: z.string().nullable(),
  country_code: z.string().nullable(),
  linkedin_url: z.string().nullable(),
  professional_emails: z.array(RevealedEmail),
  personal_emails: z.array(RevealedEmail),
  phones: z.array(RevealedPhone),
});

export const revealContactDetailsOutput = paidOutput({
  contact: RevealedContact.nullable().describe("null when nothing was found (nothing charged)"),
  returned_types: z.array(z.enum(LOOKUP_TYPES)).describe("Lookup types that returned data and were charged"),
});
