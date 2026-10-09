import type { SpendingSettings } from "@bold-mcp/core";

/** Server-rendered connect page (brief: "The connect page"). No scripts. */

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

export interface PageLinks {
  logoUrl: string;
  findKeyUrl: string;
  trialUrl: string;
}

const CSS = `
:root{--bg:#f6f7f9;--card:#fff;--text:#14181f;--muted:#5b6472;--line:#dde1e7;--accent:#0b5cad;--accent-text:#fff;--warn-bg:#fff6e5;--warn:#8a5a00;--err-bg:#fdecec;--err:#a12020;--ok:#16794a}
@media (prefers-color-scheme:dark){:root{--bg:#0f1216;--card:#171b21;--text:#e8ebef;--muted:#9aa4b2;--line:#2a313b;--accent:#4c9be8;--accent-text:#0b1220;--warn-bg:#2b2210;--warn:#f0c46b;--err-bg:#2c1414;--err:#f19999;--ok:#5fd09a}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{max-width:460px;margin:40px auto;padding:0 16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:28px}
.logo{height:36px;display:block;margin-bottom:20px}
h1{font-size:22px;line-height:1.3;margin:0 0 6px}
.host{color:var(--muted);font-size:14px;margin:0 0 22px;word-break:break-all}.host strong{color:var(--text)}
label{display:block;font-weight:600;margin:0 0 6px}
input[type=password],input[type=number]{width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--text);font:inherit}
.links{display:flex;flex-wrap:wrap;gap:4px 16px;font-size:14px;margin:8px 0 22px}
a{color:var(--accent)}
fieldset{border:1px solid var(--line);border-radius:8px;padding:14px 16px 6px;margin:0 0 20px}
legend{font-weight:600;padding:0 6px}
.row{display:flex;gap:12px}.row>div{flex:1}
.check{display:flex;gap:8px;align-items:center;font-weight:400;margin:10px 0}
.hint{color:var(--muted);font-size:13px;margin:4px 0 10px}
button,.button{display:inline-block;width:100%;padding:12px;border:0;border-radius:8px;background:var(--accent);color:var(--accent-text);font:600 16px system-ui,sans-serif;text-align:center;text-decoration:none;cursor:pointer}
.note{color:var(--muted);font-size:13px;margin:16px 0 0}
.error{background:var(--err-bg);color:var(--err);border-radius:8px;padding:10px 12px;margin:0 0 18px}
.warn{background:var(--warn-bg);color:var(--warn);border-radius:8px;padding:10px 12px;margin:0 0 18px}
table{width:100%;border-collapse:collapse;margin:8px 0 20px}td,th{padding:8px 0;border-bottom:1px solid var(--line);text-align:left}td.num{text-align:right;font-variant-numeric:tabular-nums}
.ok{color:var(--ok);font-weight:600}
`;

function layout(title: string, body: string, nonce: string, extraHead = ""): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="no-referrer"><title>${escapeHtml(title)}</title>${extraHead}
<style nonce="${nonce}">${CSS}</style></head>
<body><main><div class="card">${body}</div></main></body></html>`;
}

export interface ConnectFormProps {
  clientName: string;
  redirectHost: string;
  hidden: Record<string, string>;
  csrf: string;
  settings: SpendingSettings;
  links: PageLinks;
  error?: string;
  nonce: string;
}

export function connectPage(p: ConnectFormProps): string {
  const hidden = Object.entries(p.hidden)
    .map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`)
    .join("");
  const checked = (b: boolean) => (b ? " checked" : "");
  const body = `
<img class="logo" src="${escapeHtml(p.links.logoUrl)}" alt="Bill of Lading Data">
<h1>Connect ${escapeHtml(p.clientName)} to Bill of Lading Data</h1>
<p class="host">After connecting you will return to <strong>${escapeHtml(p.redirectHost)}</strong></p>
${p.error ? `<div class="error" role="alert">${escapeHtml(p.error)}</div>` : ""}
<form method="post" action="/authorize" autocomplete="off">
${hidden}<input type="hidden" name="csrf" value="${escapeHtml(p.csrf)}">
<label for="api_key">Paste your API key</label>
<input id="api_key" name="api_key" type="password" required minlength="16" maxlength="256" spellcheck="false" autocapitalize="off" autocomplete="off">
<div class="links"><a href="${escapeHtml(p.links.findKeyUrl)}" target="_blank" rel="noopener noreferrer">Where do I find my API key?</a><a href="${escapeHtml(p.links.trialUrl)}" target="_blank" rel="noopener noreferrer">No key? Start the free trial (1,000 API credits)</a></div>
<fieldset><legend>Spending settings</legend>
<div class="row"><div><label for="per_call_limit">Per-call limit</label><input id="per_call_limit" name="per_call_limit" type="number" min="0" max="100000" value="${p.settings.perCallLimit}"></div>
<div><label for="daily_limit">Daily limit</label><input id="daily_limit" name="daily_limit" type="number" min="0" max="1000000" value="${p.settings.dailyLimit}"></div></div>
<p class="hint">Credits. Calls above these limits ask you first.</p>
<label class="check"><input type="checkbox" name="allow_contacts" value="on"${checked(p.settings.allowContactUnlocks)}> Allow contact unlocks (emails, phones)</label>
<label class="check"><input type="checkbox" name="allow_kyb" value="on"${checked(p.settings.allowKybUnlocks)}> Allow KYB unlocks (registry reports)</label>
<p class="hint">Unlocks always ask you before spending credits.</p>
</fieldset>
<button type="submit">Connect</button>
</form>
<p class="note">Your key is stored encrypted and used only to call the Bill of Lading Data API for this connection. Disconnect any time.</p>`;
  return layout(`Connect ${p.clientName} to Bill of Lading Data`, body, p.nonce);
}

export interface ConnectedProps {
  clientName: string;
  redirectHost: string;
  continueUrl: string;
  balances: { data: number | null; contact: number | null; kyb: number | null };
  zeroBalance: boolean;
  links: PageLinks;
  nonce: string;
}

export function connectedPage(p: ConnectedProps): string {
  const n = (v: number | null) => (v === null ? "—" : v.toLocaleString("en-US"));
  const body = `
<img class="logo" src="${escapeHtml(p.links.logoUrl)}" alt="Bill of Lading Data">
<h1><span class="ok">Connected.</span> Returning to ${escapeHtml(p.clientName)}</h1>
<p class="host">You will return to <strong>${escapeHtml(p.redirectHost)}</strong></p>
${p.zeroBalance ? `<div class="warn" role="status">This account has no API plan or credits. <a href="${escapeHtml(p.links.trialUrl)}" target="_blank" rel="noopener noreferrer">Start the free trial</a>.</div>` : ""}
<p>Credits remaining on this account:</p>
<table><tbody>
<tr><th scope="row">Data credits</th><td class="num">${n(p.balances.data)}</td></tr>
<tr><th scope="row">Contact credits</th><td class="num">${n(p.balances.contact)}</td></tr>
<tr><th scope="row">KYB credits</th><td class="num">${n(p.balances.kyb)}</td></tr>
</tbody></table>
<a class="button" href="${escapeHtml(p.continueUrl)}">Continue to ${escapeHtml(p.clientName)}</a>`;
  return layout("Connected to Bill of Lading Data", body, p.nonce, `<meta http-equiv="refresh" content="6;url=${escapeHtml(p.continueUrl)}">`);
}

export function errorPage(title: string, message: string, nonce: string): string {
  return layout(title, `<h1>${escapeHtml(title)}</h1><div class="error" role="alert">${escapeHtml(message)}</div><p class="note">Close this window and try connecting again from your AI tool.</p>`, nonce);
}
