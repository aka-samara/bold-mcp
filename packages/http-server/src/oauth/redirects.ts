/** Loopback redirect URIs accepted on any port (RFC 8252; brief: Claude Code paste flow). */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function isLoopback(u: URL): boolean {
  return u.protocol === "http:" && LOOPBACK_HOSTS.has(u.hostname);
}

/** A redirect URI a client may register: https, or http on a loopback host; no fragment, no credentials. */
export function isAcceptableRedirect(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.hash || u.username || u.password) return false;
  return u.protocol === "https:" || isLoopback(u);
}

/** Exact match, except loopback URIs match on any port. */
export function redirectMatches(requested: string, registered: readonly string[]): boolean {
  let r: URL;
  try {
    r = new URL(requested);
  } catch {
    return false;
  }
  for (const reg of registered) {
    if (reg === requested) return true;
    let g: URL;
    try {
      g = new URL(reg);
    } catch {
      continue;
    }
    if (isLoopback(r) && isLoopback(g) && r.hostname === g.hostname && r.pathname === g.pathname && r.search === g.search) return true;
  }
  return false;
}
