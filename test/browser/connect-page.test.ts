// Connect page in a real browser (Playwright). Runs when a Chromium binary is
// available: BOLD_CHROMIUM_PATH, the preinstalled /opt/pw-browsers/chromium,
// or Playwright's own download (`npx playwright-core install chromium`).
import { existsSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupServer } from "msw/node";
import { chromium, type Browser, type Page } from "playwright-core";
import { createPartnerApiMock } from "../msw/handlers.ts";
import { loadFixtures } from "../fixtures/load.ts";
import { BAD_KEY, FAKE_KEY } from "../helpers/harness.ts";
import { startHttp } from "../helpers/http.ts";
import { authorizeParams, form, pkce, register, RESOURCE } from "../helpers/oauth.ts";

const executablePath = process.env.BOLD_CHROMIUM_PATH ?? (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const hasBrowser = Boolean(executablePath) || existsSync(chromium.executablePath());

const mock = createPartnerApiMock(undefined, { invalidKeys: [BAD_KEY] });
const msw = setupServer(...mock.handlers);
let browser: Browser;
let h: Awaited<ReturnType<typeof startHttp>>;
let callback: Server;
let callbackUrl: string;
let page: Page;

describe.runIf(hasBrowser)("connect page (browser)", () => {
  beforeAll(async () => {
    msw.listen({ onUnhandledFrame: "bypass" });
    browser = await chromium.launch(executablePath ? { executablePath } : {});
    callback = createServer((_req, res) => res.end("callback reached")).listen(0, "127.0.0.1");
    await new Promise((r) => callback.once("listening", r));
    callbackUrl = `http://127.0.0.1:${(callback.address() as AddressInfo).port}/cb`;
  });
  afterAll(async () => {
    await browser?.close();
    callback?.close();
    msw.close();
  });
  beforeEach(async () => {
    h = await startHttp({ BOLD_LOGO_URL: "https://cdn.example/logo.svg" });
    page = await browser.newPage();
    // Keep the test offline: the logo is the only external resource.
    await page.route("https://cdn.example/**", (r) => r.fulfill({ status: 200, contentType: "image/svg+xml", body: "<svg xmlns='http://www.w3.org/2000/svg'/>" }));
  });
  afterEach(async () => {
    await page.close();
    await h.stop();
    mock.reset();
  });

  async function open() {
    const clientId = await register(h.url, [callbackUrl], "Claude");
    const p = pkce();
    const params = authorizeParams(clientId, p.challenge, { redirect_uri: callbackUrl });
    await page.goto(`${h.url}/authorize?${new URLSearchParams(params)}`);
    return { clientId, p };
  }

  it("connects with a valid key, shows balances and returns to the client with a working code", async () => {
    const { clientId, p } = await open();
    await expect(page.locator("h1").textContent()).resolves.toBe("Connect Claude to Bill of Lading Data");
    await expect(page.locator(".host").textContent()).resolves.toContain("127.0.0.1");
    await page.getByLabel("Paste your API key").fill(FAKE_KEY);
    await page.getByLabel("Per-call limit").fill("60");
    await page.getByLabel("Allow contact unlocks (emails, phones)").uncheck();
    await page.getByRole("button", { name: "Connect" }).click();
    await page.waitForSelector("text=Connected.");
    expect(await page.locator("table").textContent()).toContain("Data credits");
    const body = await page.content();
    expect(body).not.toContain(FAKE_KEY);
    expect(page.url()).not.toContain(FAKE_KEY);

    await page.getByRole("link", { name: "Continue to Claude" }).click();
    await page.waitForURL(/\/cb\?/);
    const url = new URL(page.url());
    expect(await page.textContent("body")).toContain("callback reached");
    expect(url.searchParams.get("state")).toBe("st-123");
    const tok = await fetch(`${h.url}/token`, form({ grant_type: "authorization_code", code: url.searchParams.get("code") as string, code_verifier: p.verifier, client_id: clientId, redirect_uri: callbackUrl, resource: RESOURCE }));
    const tokens = (await tok.json()) as { access_token: string };
    const conn = await h.services.db.connections.get((await h.services.tokens.checkAccess(tokens.access_token, RESOURCE))?.connectionId as string);
    expect(conn?.settings).toMatchObject({ perCallLimit: 60, allowContactUnlocks: false, allowKybUnlocks: true });
  });

  it("says 'Key not recognised' and clears the field for a wrong key", async () => {
    await open();
    await page.getByLabel("Paste your API key").fill(BAD_KEY);
    await page.getByRole("button", { name: "Connect" }).click();
    await page.waitForSelector("text=Key not recognised. Paste it again.");
    expect(await page.getByLabel("Paste your API key").inputValue()).toBe("");
    expect(await page.content()).not.toContain(BAD_KEY);
  });

  it("warns about a zero-balance account and links the free trial", async () => {
    const ok = loadFixtures().get("credit-usage")?.responses.ok?.body;
    mock.setResponse("credit-usage", 200, JSON.parse(JSON.stringify(ok), (k, v: unknown) => (typeof v === "number" && k !== "code" ? 0 : v)));
    await open();
    await page.getByLabel("Paste your API key").fill(FAKE_KEY);
    await page.getByRole("button", { name: "Connect" }).click();
    await page.waitForSelector("text=This account has no API plan or credits.");
    expect(await page.getByRole("link", { name: "Start the free trial" }).count()).toBe(1);
  });

  it("asks again when the page expired (CSRF cookie gone)", async () => {
    await open();
    await page.context().clearCookies();
    await page.getByLabel("Paste your API key").fill(FAKE_KEY);
    await page.getByRole("button", { name: "Connect" }).click();
    await page.waitForSelector("text=This page expired. Paste your key again.");
  });

  it("stops after 5 attempts in 15 minutes", async () => {
    await open();
    for (let i = 0; i < 5; i++) {
      await page.getByLabel("Paste your API key").fill(BAD_KEY);
      await page.getByRole("button", { name: "Connect" }).click();
      await page.waitForSelector("text=Key not recognised");
    }
    await page.getByLabel("Paste your API key").fill(FAKE_KEY);
    await page.getByRole("button", { name: "Connect" }).click();
    await page.waitForSelector("text=Too many attempts");
  });

  it("fits a phone screen without horizontal scrolling", async () => {
    await page.setViewportSize({ width: 360, height: 740 });
    await open();
    const overflow = await page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth");
    expect(Number(overflow)).toBeLessThanOrEqual(0);
  });

  it("shows an error page, not a redirect, for an unregistered return address", async () => {
    const clientId = await register(h.url, [callbackUrl]);
    await page.goto(`${h.url}/authorize?${new URLSearchParams(authorizeParams(clientId, pkce().challenge, { redirect_uri: "https://evil.example/cb" }))}`);
    expect(page.url()).toContain(h.url);
    expect(await page.textContent("body")).toContain("not registered for this app");
  });
});
