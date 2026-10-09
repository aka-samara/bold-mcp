import type { Response } from "express";

/** RFC 9728 challenge pointing clients at the protected-resource metadata. */
export function sendUnauthorized(res: Response, publicUrl: string, description: string, error = "invalid_token"): void {
  res
    .status(401)
    .set(
      "WWW-Authenticate",
      `Bearer resource_metadata="${publicUrl}/.well-known/oauth-protected-resource", scope="bold"${error ? `, error="${error}", error_description="${description.replace(/"/g, "'")}"` : ""}`,
    )
    .json({ error: error || "unauthorized", error_description: description });
}
