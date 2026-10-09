import { describe, expect, it } from "vitest";
import { ESLint } from "eslint";

const eslint = new ESLint({ overrideConfigFile: new URL("../../eslint.config.js", import.meta.url).pathname });

async function lint(code: string) {
  const [result] = await eslint.lintText(code, { filePath: "packages/core/src/example.ts" });
  return (result?.messages ?? []).filter((m) => m.ruleId === "no-restricted-syntax");
}

describe("lint rule: never log keys or tokens", () => {
  it.each([
    "declare const logger: { info(...a: unknown[]): void }; declare const apiKey: string; logger.info({ apiKey }, 'x');",
    "declare const logger: { info(...a: unknown[]): void }; declare const token: string; logger.info(`t ${token}`);",
    "declare const key: string; console.log(key);",
    "declare const log: { error(...a: unknown[]): void }; declare const c: { apiKey: string }; log.error({ k: c.apiKey });",
  ])("blocks %s", async (code) => {
    expect((await lint(code)).length).toBeGreaterThan(0);
  });

  it("allows logging the fingerprint", async () => {
    expect(await lint("declare const logger: { info(...a: unknown[]): void }; declare const fp: string; logger.info({ key_fp: fp }, 'x');")).toHaveLength(0);
  });
});
