import { createHash, randomBytes } from "node:crypto";

/** Minimal OAuth client driving the paste-your-key flow over plain HTTP, like an AI client plus a browser would. */
export const REDIRECT = "https://client.example/callback";
/** BOLD_PUBLIC_URL used by startHttp. */
export const PUBLIC_URL = "https://mcp.test.example";
export const RESOURCE = `${PUBLIC_URL}/mcp`;

export function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

export function form(body: Record<string, string>): RequestInit {
  return { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body).toString(), redirect: "manual" };
}

export async function register(base: string, redirectUris: string[] = [REDIRECT], name = "Test Client"): Promise<string> {
  const res = await fetch(`${base}/register`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: name, redirect_uris: redirectUris }) });
  if (res.status !== 201) throw new Error(`register failed: ${res.status}`);
  return ((await res.json()) as { client_id: string }).client_id;
}

export function authorizeParams(clientId: string, challenge: string, extra: Record<string, string> = {}): Record<string, string> {
  return {
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: RESOURCE,
    scope: "bold",
    state: "st-123",
    ...extra,
  };
}

/** GET /authorize and pull the CSRF token and cookie out of the page. */
export async function openConnectPage(base: string, params: Record<string, string>) {
  const res = await fetch(`${base}/authorize?${new URLSearchParams(params)}`, { redirect: "manual" });
  const html = await res.text();
  const csrf = /name="csrf" value="([^"]+)"/.exec(html)?.[1];
  const cookie = /bold_csrf=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1];
  return { res, html, csrf, cookie };
}

export async function submitKey(base: string, params: Record<string, string>, page: { csrf?: string | undefined; cookie?: string | undefined }, apiKey: string, extra: Record<string, string> = {}) {
  const init = form({ ...params, csrf: page.csrf ?? "", api_key: apiKey, ...extra });
  init.headers = { ...(init.headers as Record<string, string>), ...(page.cookie ? { cookie: `bold_csrf=${page.cookie}` } : {}) };
  const res = await fetch(`${base}/authorize`, init);
  const html = await res.text();
  const href = /class="button" href="([^"]+)"/.exec(html)?.[1]?.replace(/&amp;/g, "&");
  return { res, html, continueUrl: href ? new URL(href) : undefined };
}

/** Whole flow: register → connect page → paste key → exchange code. */
export async function signIn(base: string, apiKey: string, extra: Record<string, string> = {}) {
  const clientId = await register(base);
  const { verifier, challenge } = pkce();
  const params = authorizeParams(clientId, challenge);
  const page = await openConnectPage(base, params);
  const submitted = await submitKey(base, params, page, apiKey, extra);
  const code = submitted.continueUrl?.searchParams.get("code");
  if (!code) throw new Error(`no code: ${submitted.res.status}`);
  const tok = await fetch(`${base}/token`, form({ grant_type: "authorization_code", code, code_verifier: verifier, client_id: clientId, redirect_uri: REDIRECT, resource: RESOURCE }));
  const tokens = (await tok.json()) as { access_token: string; refresh_token: string; expires_in: number };
  return { clientId, verifier, code, tokens, submitted };
}
