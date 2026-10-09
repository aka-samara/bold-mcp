import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(new URL("../../scripts/check-key-leak.mjs", import.meta.url));
// Fake key built at runtime so this file never contains its own prefix.
const FAKE_KEY = ["zq9x", "7w3v", "-fake-test-key-not-real-000000"].join("");
const PREFIX = FAKE_KEY.slice(0, 8);

let dir: string;

function run(env: Record<string, string>, ...args: string[]) {
  const clean = { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" };
  const r = spawnSync(process.execPath, [SCRIPT, "--root", dir, ...args], { cwd: dir, env: { ...clean, ...env }, encoding: "utf8" });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

function git(...args: string[]) {
  execFileSync("git", args, { cwd: dir, stdio: "ignore" });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "keyleak-"));
  git("init", "-q");
  git("config", "user.email", "t@example.invalid");
  git("config", "user.name", "t");
  writeFileSync(join(dir, "clean.txt"), "nothing to see\n");
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("check-key-leak", () => {
  it("skips when no key is configured", () => {
    expect(run({}).code).toBe(0);
  });

  it("fails when no key is configured and KEY_LEAK_REQUIRE=1", () => {
    expect(run({ KEY_LEAK_REQUIRE: "1" }).code).toBe(1);
  });

  it("passes on a clean tree", () => {
    const r = run({ BOLD_TEST_API_KEY: FAKE_KEY });
    expect(r.code).toBe(0);
    expect(r.out).toContain("passed");
  });

  it("fails when the prefix is in an untracked file, without printing it", () => {
    writeFileSync(join(dir, "leak.json"), JSON.stringify({ header: `${PREFIX}rest` }));
    const r = run({ BOLD_TEST_API_KEY: FAKE_KEY });
    expect(r.code).toBe(1);
    expect(r.out).toContain("leak.json");
    expect(r.out).not.toContain(PREFIX);
  });

  it("ignores gitignored files", () => {
    writeFileSync(join(dir, ".gitignore"), "ignored.log\n");
    writeFileSync(join(dir, "ignored.log"), PREFIX);
    expect(run({ BOLD_TEST_API_KEY: FAKE_KEY }).code).toBe(0);
  });

  it("finds the prefix in history with --history", () => {
    writeFileSync(join(dir, "leak.txt"), PREFIX);
    git("add", ".");
    git("commit", "-qm", "leak");
    rmSync(join(dir, "leak.txt"));
    git("add", "-A");
    git("commit", "-qm", "remove");
    expect(run({ BOLD_TEST_API_KEY: FAKE_KEY }).code).toBe(0);
    const r = run({ BOLD_TEST_API_KEY: FAKE_KEY }, "--history");
    expect(r.code).toBe(1);
    expect(r.out).toMatch(/commit [0-9a-f]+/);
    expect(r.out).not.toContain(PREFIX);
  });
});
