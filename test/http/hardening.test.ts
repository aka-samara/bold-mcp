import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { setupServer } from "msw/node";
import { createPartnerApiMock } from "../msw/handlers.ts";
import { INIT_BODY, startHttp } from "../helpers/http.ts";
import { authorizeParams, pkce, register } from "../helpers/oauth.ts";

const mock = createPartnerApiMock();
const msw = setupServer(...mock.handlers);
beforeAll(() => msw.listen({ onUnhandledFrame: "bypass" }));
afterEach(() => mock.reset());
afterAll(() => msw.close());

const post = (url: string, headers: Record<string, string>, body: string = JSON.stringify(INIT_BODY)) =>
  fetch(`${url}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers }, body });

const fakeKey = (i: number) => `hardening-test-key-${String(i).padStart(4, "0")}-xxxxxxxx`;

describe("hardening", () => {
  it("sets security headers, with HSTS on an https public URL", async () => {
    const h = await startHttp();
    const res = await fetch(`${h.url}/healthz`);
    await h.stop();
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("strict-transport-security")).toContain("max-age=");
    expect(res.headers.get("x-powered-by")).toBeNull();
  });

  it("limits new-key checks to 20 a minute per IP; cached keys are not limited", async () => {
    const h = await startHttp();
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) statuses.push((await post(h.url, { authorization: `Bearer ${fakeKey(i)}` })).status);
    // A key already checked still works.
    const again = await post(h.url, { authorization: `Bearer ${fakeKey(0)}` });
    await h.stop();
    expect(statuses.slice(0, 20).every((s) => s === 200)).toBe(true);
    expect(statuses[20]).toBe(429);
    expect(again.status).toBe(200);
    expect(mock.calls.filter((c) => c.path === "credit-usage")).toHaveLength(20);
  });

  it("ignores X-Forwarded-For unless proxy hops are configured", async () => {
    const h = await startHttp();
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) statuses.push((await post(h.url, { authorization: `Bearer ${fakeKey(100 + i)}`, "x-forwarded-for": `203.0.113.${i}` })).status);
    await h.stop();
    expect(statuses[20]).toBe(429);
  });

  it("uses the forwarded client IP behind one trusted proxy", async () => {
    const h = await startHttp({ BOLD_TRUST_PROXY_HOPS: "1" });
    const statuses: number[] = [];
    for (let i = 0; i < 21; i++) statuses.push((await post(h.url, { authorization: `Bearer ${fakeKey(200 + i)}`, "x-forwarded-for": `203.0.113.${i}` })).status);
    await h.stop();
    expect(statuses.every((s) => s === 200)).toBe(true);
  });

  it("rate-limits GET /authorize (each one may fetch client metadata)", async () => {
    const h = await startHttp();
    const clientId = await register(h.url);
    const params = new URLSearchParams(authorizeParams(clientId, pkce().challenge));
    let last = 0;
    for (let i = 0; i < 61; i++) last = (await fetch(`${h.url}/authorize?${params}`)).status;
    await h.stop();
    expect(last).toBe(429);
  });

  it("answers malformed JSON without a stack trace", async () => {
    const h = await startHttp();
    const res = await post(h.url, { authorization: `Bearer ${fakeKey(999)}` }, "{not json");
    const text = await res.text();
    await h.stop();
    expect(res.status).toBe(400);
    expect(text).not.toMatch(/at .*\.(js|ts):\d+/);
    expect(text).not.toContain("SyntaxError");
  });
});
