# Directory listing drafts

Drafts for the team to edit and approve (brief, "Inputs needed" #7). Nothing here has been submitted. Tool names and descriptions are frozen once ChatGPT approves the app, so review `docs/tools.md` before submitting.

## Names and descriptions

- **Name:** Bill of Lading Data
- **Short description (≤ 100 characters):** Global import/export trade data: shipments, buyers, suppliers, contacts and KYB, with your API key.
- **Long description:**
  Bring Bill of Lading Data's global trade records into your AI assistant. Size a market by HS code or product, find importers and exporters, look up shipments and bills of lading, compare competitors, preview the people at a company, and pull registry (KYB) reports. Connect with your existing Bill of Lading Data API key: paste it once on our sign-in page, and your assistant uses your account's credits exactly as the API does today. Free tools are used first; anything that spends credits above your limits, and every contact or KYB unlock, asks you before it runs.
- **Category:** Data / Business research
- **Logo:** `https://billofladingdata.com/assets/BLO-LOGO.png`
- **Website:** `https://billofladingdata.com`
- **Support email:** _needed from the team_
- **Privacy policy URL:** _needed from the team (must cover stored API keys and AI-client use)_
- **Terms URL:** _needed from the team_

## Example prompts (for reviewers and listings)

1. "Using Bill of Lading Data, how big is the US import market for HS 940360 over the last 12 months?"
2. "Find the top 5 US importers of wooden furniture and check none are freight forwarders."
3. "Who supplies ACME Home Furnishings? Show their latest shipments."
4. "Run a due-diligence check on Example Holdings Ltd in the UK."
5. "How many credits have I used this week, and on what?"

## Reviewer access

- A separate reviewer test key with enough data, contact and KYB credits for a review (suggested: 1,000 data, 100 contact, 100 KYB) — _needed from the team_.
- Reviewer steps: add the server URL as a custom connector, paste the reviewer key on the connect page, then try the prompts above.

## Where to submit (after production runs cleanly with beta customers)

| Directory | What it needs |
| --- | --- |
| npm `@billofladingdata/mcp` | npm organisation `billofladingdata` and a publish token |
| Official MCP Registry | `server.json` (repo root), namespace `com.billofladingdata` verified by DNS TXT record, `mcp-publisher` login |
| Claude Connectors Directory | URL, privacy policy, logo, support contact, reviewer key, example prompts |
| ChatGPT app directory | Developer account verification, privacy policy, reviewer key, test prompts; tool names frozen at approval |
| Cursor and other directories | URL and short description |
