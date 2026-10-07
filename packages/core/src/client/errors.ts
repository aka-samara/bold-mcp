export type PartnerErrorKind =
  | "bad_request" // 400
  | "unauthorized" // 401: key not recognised
  | "payment_required" // 402: out of credits
  | "forbidden" // 403
  | "not_found" // 404
  | "rate_limited" // 429 (not documented, handled anyway)
  | "server" // 5xx
  | "timeout"
  | "network"
  | "bad_response"; // 200 with a body we cannot parse

/**
 * An error from the Partner API. `detail` is the API's own message, already
 * scrubbed of the key and truncated; it is safe to show the AI client.
 */
export class PartnerApiError extends Error {
  constructor(
    public readonly kind: PartnerErrorKind,
    public readonly status: number | null,
    public readonly detail: string | null,
    public readonly path: string,
  ) {
    super(`Partner API ${path}: ${kind}${status ? ` (HTTP ${status})` : ""}`);
    this.name = "PartnerApiError";
  }

  get retryable(): boolean {
    return this.kind === "rate_limited" || this.kind === "server" || this.kind === "timeout" || this.kind === "network";
  }
}

export function kindForStatus(status: number): PartnerErrorKind {
  if (status === 400) return "bad_request";
  if (status === 401) return "unauthorized";
  if (status === 402) return "payment_required";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "server";
  return "bad_response";
}

/** Thrown when a stored (OAuth) key is rejected; the HTTP layer answers 401 so the client re-runs Connect. */
export class StoredKeyRejectedError extends Error {
  constructor() {
    super("Stored API key was rejected by the Partner API");
    this.name = "StoredKeyRejectedError";
  }
}

// Placeholder until the team gives a top-up URL (docs/decisions.md D14).
const TOP_UP = "https://billofladingdata.com";

/**
 * Message for the AI client, per the brief's error table. Never contains the
 * key: `detail` was scrubbed by the client.
 */
export function toolErrorMessage(err: PartnerApiError, pool?: string | null): string {
  switch (err.kind) {
    case "bad_request":
      return `The request was rejected: ${err.detail ?? "invalid input"}. Fix that field and try again.`;
    case "unauthorized":
      return "API key not recognised — check the key in your client settings.";
    case "payment_required":
      return `Not enough ${pool ? `${pool} ` : ""}credits for this call — top up at ${TOP_UP}.`;
    case "forbidden":
      return "This API key doesn't have access to this data — contact Bill of Lading Data.";
    case "not_found":
      return "Nothing found for that id — run find_company_id first to get a valid company_id.";
    case "timeout":
      return "The Bill of Lading Data API took too long to answer. Try a narrower filter (fewer HS codes, a shorter date_range or a country).";
    case "rate_limited":
      return "The Bill of Lading Data API is rate-limiting this key. Wait a minute and try again.";
    case "server":
    case "network":
      return "The Bill of Lading Data API is unavailable right now. Try again shortly.";
    case "bad_response":
      return "The Bill of Lading Data API returned a response this server could not read. Try again; if it persists, contact support.";
  }
}
