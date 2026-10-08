import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { setupServer } from "msw/node";
import { DEFAULT_SETTINGS, type UnlockAuditEntry } from "@bold-mcp/core";
import { createPartnerApiMock } from "../msw/handlers.ts";
import { callerFor, connectInMemory, FAKE_KEY, testDeps } from "../helpers/harness.ts";
import { UNLOCK_SAMPLE_ARGS } from "../helpers/samples.ts";

const mock = createPartnerApiMock();
const server = setupServer(...mock.handlers);
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => mock.reset());
afterAll(() => server.close());

type Result = { isError?: boolean; content: { text: string }[]; structuredContent?: Record<string, unknown> };
const UNLOCK_PATHS = ["contact-look-up", "advanced-kyb-search", "financial-kyb", "shareholders-kyb", "officers-kyb"];
const unlockCalls = () => mock.calls.filter((c) => UNLOCK_PATHS.includes(c.path));

async function session(opts: Parameters<typeof connectInMemory>[2] = {}, settings = DEFAULT_SETTINGS) {
  const { deps, logs } = testDeps();
  const audits: UnlockAuditEntry[] = [];
  deps.onUnlock = (e) => audits.push(e);
  const conn = await connectInMemory(deps, callerFor(FAKE_KEY, { settings, connectionId: "conn-1" }), opts);
  const call = async (name: string, args: Record<string, unknown>) => (await conn.client.callTool({ name, arguments: args })) as Result;
  /** Call, then confirm with the returned token, as a client without elicitation does. */
  const confirmed = async (name: string, args: Record<string, unknown>) => {
    const first = await call(name, args);
    expect(first.structuredContent?.status, first.content[0]?.text).toBe("confirmation_required");
    const token = (first.structuredContent?.confirmation as { confirmation_token: string }).confirmation_token;
    return call(name, { ...args, confirmation_token: token });
  };
  return { ...conn, call, confirmed, deps, logs, audits };
}

describe("unlock tools always ask", () => {
  it.each(Object.entries(UNLOCK_SAMPLE_ARGS))("%s returns confirmation_required even far below every limit, without calling the API", async (tool, args) => {
    const s = await session({}, { ...DEFAULT_SETTINGS, perCallLimit: 100_000, dailyLimit: 1_000_000 });
    const r = await s.call(tool, args);
    await s.close();
    expect(r.structuredContent?.status).toBe("confirmation_required");
    expect((r.structuredContent?.confirmation as { reasons: string[] }).reasons.join(" ")).toMatch(/unlocks always need the user's confirmation/);
    expect(unlockCalls()).toHaveLength(0);
  });

  it("asks through elicitation when available, and spends nothing on decline", async () => {
    const declined = await session({ elicit: () => ({ action: "decline" }) });
    const r = await declined.call("reveal_contact_details", UNLOCK_SAMPLE_ARGS.reveal_contact_details as Record<string, unknown>);
    await declined.close();
    expect(r.structuredContent?.status).toBe("cancelled");
    expect(unlockCalls()).toHaveLength(0);

    const accepted = await session({ elicit: () => ({ action: "accept", content: { confirm: true } }) });
    const ok = await accepted.call("reveal_contact_details", UNLOCK_SAMPLE_ARGS.reveal_contact_details as Record<string, unknown>);
    await accepted.close();
    expect(ok.structuredContent?.status).toBe("ok");
    expect(unlockCalls()).toHaveLength(1);
  });

  it("refuses when the connection's allow switch is off, without asking or calling", async () => {
    let asked = false;
    const s = await session({ elicit: () => ((asked = true), { action: "accept", content: { confirm: true } }) }, { ...DEFAULT_SETTINGS, allowContactUnlocks: false, allowKybUnlocks: false });
    for (const [tool, args] of Object.entries(UNLOCK_SAMPLE_ARGS)) {
      const r = await s.call(tool, args);
      expect(r.isError, tool).toBe(true);
      expect(r.content[0]?.text).toMatch(/unlocks are turned off for this connection/);
    }
    await s.close();
    expect(asked).toBe(false);
    expect(unlockCalls()).toHaveLength(0);
  });

  it("a token is single-use: a second unlock asks again", async () => {
    const s = await session();
    const args = UNLOCK_SAMPLE_ARGS.reveal_contact_details as Record<string, unknown>;
    const first = await s.call("reveal_contact_details", args);
    const token = (first.structuredContent?.confirmation as { confirmation_token: string }).confirmation_token;
    expect((await s.call("reveal_contact_details", { ...args, confirmation_token: token })).structuredContent?.status).toBe("ok");
    const again = await s.call("reveal_contact_details", { ...args, confirmation_token: token });
    await s.close();
    expect(again.structuredContent?.status).toBe("confirmation_required");
    expect(again.content[0]?.text).toContain("already used");
    expect(unlockCalls()).toHaveLength(1);
  });

  it("refuses up front when the pool cannot cover the worst case", async () => {
    const s = await session();
    mock.setResponse("credit-usage", 200, { code: 200, message: "Success", data: { credits: { data_credits: { total: 1, used: 0, remaining: 1 }, contact_credits: { total: 100, used: 95, remaining: 5 }, kyb_credits: { total: 100, used: 100, remaining: 0 } } } });
    const r = await s.call("reveal_contact_details", UNLOCK_SAMPLE_ARGS.reveal_contact_details as Record<string, unknown>);
    await s.close();
    expect(r.isError).toBe(true);
    expect(r.content[0]?.text).toContain("Not enough contact credits — you have 5 left");
  });
});

describe("reveal_contact_details", () => {
  it("returns the requested details, drops profile_pic, charges per type returned and audits the unlock", async () => {
    const s = await session();
    const r = await s.confirmed("reveal_contact_details", { contact_id: "ct_synthetic_001", lookup_type: ["professional_emails", "phones"] });
    await s.close();
    expect(mock.calls.find((c) => c.path === "contact-look-up")?.body).toEqual({ contact_id: "ct_synthetic_001", lookup_type: ["professional_emails", "phones"] });
    expect(r.structuredContent).toMatchObject({
      status: "ok",
      pool: "contact",
      returned_types: ["professional_emails"],
      credits_used: 10,
      contact: { contact_id: "ct_synthetic_001", professional_emails: [{ email: "jane@acme.example", verification: "A" }], phones: [] },
    });
    expect(JSON.stringify(r.structuredContent)).not.toContain("profile_pic");
    // Revealed details stay out of the summary.
    expect(r.content[0]?.text).not.toContain("jane@acme.example");
    expect(r.content[0]?.text).toContain("Unlocked 1 professional email.");
    expect(s.audits).toEqual([expect.objectContaining({ tool: "reveal_contact_details", subject_type: "contact", subject_id: "ct_synthetic_001", unlocked: ["professional_emails"], connection_id: "conn-1", credits_used: 10 })]);
    // Logs carry the audit ids but never the revealed details.
    const logs = s.logs.join("");
    expect(logs).toContain('"subject_id":"ct_synthetic_001"');
    expect(logs).not.toContain("jane@acme.example");
    expect(logs).not.toContain("Jane Example");
  });

  it("charges nothing and audits nothing when nothing is found", async () => {
    const s = await session();
    mock.setScenario("contact-look-up", "empty");
    const r = await s.confirmed("reveal_contact_details", UNLOCK_SAMPLE_ARGS.reveal_contact_details as Record<string, unknown>);
    await s.close();
    expect(r.structuredContent).toMatchObject({ status: "ok", credits_used: 0, returned_types: [], contact: null });
    expect(s.audits).toHaveLength(0);
  });

  it("rejects duplicate or unknown lookup types", async () => {
    const s = await session();
    for (const lookup_type of [[], ["phones", "phones"], ["fax"]]) {
      const r = await s.call("reveal_contact_details", { contact_id: "x", lookup_type });
      expect(r.isError, JSON.stringify(lookup_type)).toBe(true);
    }
    await s.close();
  });
});

describe("get_kyb_report", () => {
  it("calls each requested section once and shapes them", async () => {
    const s = await session();
    const r = await s.confirmed("get_kyb_report", UNLOCK_SAMPLE_ARGS.get_kyb_report as Record<string, unknown>);
    await s.close();
    expect(unlockCalls().map((c) => c.path)).toEqual(["advanced-kyb-search", "financial-kyb", "shareholders-kyb", "officers-kyb"]);
    expect(mock.calls.find((c) => c.path === "officers-kyb")?.body).toEqual({ kyb_id: "kyb_synthetic_001", page_size: 2, page_no: 1 });
    expect(mock.calls.find((c) => c.path === "financial-kyb")?.body).toEqual({ kyb_id: "kyb_synthetic_001" });
    const sc = r.structuredContent as Record<string, unknown>;
    expect(sc).toMatchObject({ status: "ok", pool: "kyb", credits_used: 40, returned_sections: ["details", "financials", "shareholders", "officers"] });
    expect(sc.details).toMatchObject({ name: "ACME HOME FURNISHINGS LLC", status: "Active", incorporation_date: "2001-04-12" });
    expect(sc.financials).toEqual([{ group: "Income statement", years: ["2024", "2025"], rows: [{ item: "Revenue", "2024": 1000000, "2025": 1200000 }] }]);
    expect(sc.shareholders).toMatchObject({ total: 37, has_more: true, rows: [{ name: "Example Holdings Ltd", percentage: 60 }] });
    const officer = (sc.officers as { rows: Record<string, unknown>[] }).rows[0];
    expect(officer).toMatchObject({ name: "John Example", job_title: "Director" });
    expect(officer).not.toHaveProperty("date_of_birth");
    expect(JSON.stringify(sc)).not.toContain("1970-01");
  });

  it("estimates 10 credits per requested section", async () => {
    const s = await session();
    const r = await s.call("get_kyb_report", { kyb_id: "k", sections: ["details", "officers"] });
    await s.close();
    expect((r.structuredContent?.confirmation as { estimated_max_credits: number }).estimated_max_credits).toBe(20);
  });

  it("charges only sections that returned data; a failing section does not lose the others", async () => {
    const s = await session();
    mock.setScenario("financial-kyb", "404");
    mock.setScenario("shareholders-kyb", "empty");
    const r = await s.confirmed("get_kyb_report", UNLOCK_SAMPLE_ARGS.get_kyb_report as Record<string, unknown>);
    await s.close();
    expect(r.structuredContent).toMatchObject({ returned_sections: ["details", "officers"], credits_used: 20, financials: null, shareholders: null });
    expect(Object.keys(r.structuredContent?.section_errors as object)).toEqual(["financials"]);
    expect(s.audits[0]).toMatchObject({ subject_type: "kyb", subject_id: "kyb_synthetic_001", unlocked: ["details", "officers"] });
  });

  it("returns a tool error when every section fails", async () => {
    const s = await session();
    for (const p of ["advanced-kyb-search", "financial-kyb"] as const) mock.setScenario(p, "404");
    const r = await s.confirmed("get_kyb_report", { kyb_id: "kyb_synthetic_001", sections: ["details", "financials"] });
    await s.close();
    expect(r.isError).toBe(true);
    expect(s.audits).toHaveLength(0);
  });
});
