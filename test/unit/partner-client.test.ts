import { describe, expect, it } from "vitest";
import { PartnerApiClient, PartnerApiError, sanitizeDetail, toolErrorMessage } from "@bold-mcp/core";
import { FAKE_KEY } from "../helpers/harness.ts";

function stubFetch(responses: (() => Response | Promise<Response>)[]) {
  const seen: { url: string; headers: Headers; body: string }[] = [];
  let i = 0;
  const f = (async (url: string | URL, init?: RequestInit) => {
    seen.push({ url: String(url), headers: new Headers(init?.headers), body: String(init?.body) });
    const next = responses[Math.min(i++, responses.length - 1)];
    if (!next) throw new Error("no response");
    return next();
  }) as typeof fetch;
  return { f, seen };
}

const json = (status: number, body: unknown) => () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const client = (f: typeof fetch, timeoutMs = 5000) => new PartnerApiClient({ baseUrl: "https://api.example/partner-api/", timeoutMs, fetch: f, sleep: async () => undefined });

describe("PartnerApiClient", () => {
  it("POSTs JSON with the key only in the api-key header", async () => {
    const { f, seen } = stubFetch([json(200, { code: 200, message: "ok", data: { x: 1 } })]);
    const res = await client(f).call("insights", { type: "imp" }, FAKE_KEY);
    expect(res.data).toEqual({ x: 1 });
    expect(seen[0]?.url).toBe("https://api.example/partner-api/insights");
    expect(seen[0]?.headers.get("api-key")).toBe(FAKE_KEY);
    expect(seen[0]?.url).not.toContain(FAKE_KEY);
    expect(seen[0]?.body).not.toContain(FAKE_KEY);
  });

  it("retries 5xx and 429 at most twice", async () => {
    const ok = stubFetch([json(500, {}), json(429, {}), json(200, { code: 200, data: [] })]);
    expect((await client(ok.f).call("products", {}, FAKE_KEY)).attempts).toBe(3);
    const bad = stubFetch([json(503, {}), json(503, {}), json(503, {}), json(200, { data: 1 })]);
    await expect(client(bad.f).call("products", {}, FAKE_KEY)).rejects.toMatchObject({ kind: "server" });
    expect(bad.seen).toHaveLength(3);
  });

  it("does not retry 400, 401, 402, 403, 404", async () => {
    for (const [status, kind] of [[400, "bad_request"], [401, "unauthorized"], [402, "payment_required"], [403, "forbidden"], [404, "not_found"]] as const) {
      const s = stubFetch([json(status, { code: status, message: "m", data: null })]);
      await expect(client(s.f).call("insights", {}, FAKE_KEY)).rejects.toMatchObject({ kind, status });
      expect(s.seen).toHaveLength(1);
    }
  });

  it("treats an error code inside a 200 body as an error", async () => {
    const s = stubFetch([json(200, { code: 402, message: "Insufficient credits", data: null })]);
    await expect(client(s.f).call("shipping-records", {}, FAKE_KEY)).rejects.toMatchObject({ kind: "payment_required" });
  });

  it("maps network errors and timeouts, retrying them", async () => {
    const s = stubFetch([() => Promise.reject(new Error(`boom ${FAKE_KEY}`))]);
    const err = await client(s.f).call("insights", {}, FAKE_KEY).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PartnerApiError);
    expect((err as PartnerApiError).kind).toBe("network");
    expect(String((err as Error).message)).not.toContain(FAKE_KEY);
    expect(s.seen).toHaveLength(3);

    const f = (async (_u: string | URL, init?: RequestInit) =>
      new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted"))))) as typeof fetch;
    await expect(client(f, 1000).call("insights", {}, FAKE_KEY)).rejects.toMatchObject({ kind: "timeout" });
  });

  it("rejects unparseable 200 bodies", async () => {
    const s = stubFetch([() => new Response("<html>", { status: 200 })]);
    await expect(client(s.f).call("insights", {}, FAKE_KEY)).rejects.toMatchObject({ kind: "bad_response" });
  });

  it("scrubs the key from API messages", async () => {
    const s = stubFetch([json(400, { code: 400, message: `bad key ${FAKE_KEY} and prefix ${FAKE_KEY.slice(0, 8)}`, data: null })]);
    const err = (await client(s.f).call("insights", {}, FAKE_KEY).catch((e: unknown) => e)) as PartnerApiError;
    expect(err.detail).not.toContain(FAKE_KEY.slice(0, 8));
    expect(toolErrorMessage(err)).not.toContain(FAKE_KEY.slice(0, 8));
    expect(sanitizeDetail("x".repeat(400), FAKE_KEY)?.length).toBe(301);
  });
});

describe("toolErrorMessage", () => {
  const e = (kind: ConstructorParameters<typeof PartnerApiError>[0], detail: string | null = null) => new PartnerApiError(kind, null, detail, "insights");
  it("follows the brief's error table", () => {
    expect(toolErrorMessage(e("bad_request", "date_range exceeds 12 months"))).toContain("date_range exceeds 12 months");
    expect(toolErrorMessage(e("unauthorized"))).toBe("API key not recognised — check the key in your client settings.");
    expect(toolErrorMessage(e("payment_required"), "contact")).toContain("Not enough contact credits");
    expect(toolErrorMessage(e("forbidden"))).toContain("doesn't have access");
    expect(toolErrorMessage(e("not_found"))).toContain("run find_company_id first");
    expect(toolErrorMessage(e("timeout"))).toContain("narrower filter");
  });
});
