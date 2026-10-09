#!/usr/bin/env node
// Fails if the first 8 characters of any configured API key appear anywhere
// in the repository: every tracked or untracked (non-ignored) file, and with
// --history every commit on every ref. The prefix itself is never printed.
//
// Keys are read from BOLD_TEST_API_KEY and BOLD_API_KEY (and any extra names
// in KEY_LEAK_VARS, comma-separated). With no key set the check is skipped,
// unless KEY_LEAK_REQUIRE=1, in which case a missing key is a failure.
//
// Usage: node scripts/check-key-leak.mjs [--history] [--root <dir>] [--paths <dir>...]

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const PREFIX_LENGTH = 8;

function parseArgs(argv) {
  const args = { history: false, root: process.cwd(), paths: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--history") args.history = true;
    else if (a === "--root") args.root = resolve(argv[++i]);
    else if (a === "--paths") {
      while (argv[i + 1] && !argv[i + 1].startsWith("--")) args.paths.push(resolve(argv[++i]));
    } else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

function keyPrefixes() {
  const names = ["BOLD_TEST_API_KEY", "BOLD_API_KEY", ...(process.env.KEY_LEAK_VARS ?? "").split(",")]
    .map((n) => n.trim())
    .filter(Boolean);
  const found = [];
  for (const name of new Set(names)) {
    const value = (process.env[name] ?? "").trim();
    if (value.length >= PREFIX_LENGTH) found.push({ name, prefix: value.slice(0, PREFIX_LENGTH) });
  }
  return found;
}

function gitFiles(root) {
  const out = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: root });
  return out.toString("utf8").split("\0").filter(Boolean).map((f) => join(root, f));
}

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p, acc);
    else if (entry.isFile()) acc.push(p);
  }
  return acc;
}

function scanFiles(files, prefixes, root) {
  const hits = [];
  for (const file of files) {
    let buf;
    try {
      if (!statSync(file).isFile()) continue;
      buf = readFileSync(file);
    } catch {
      continue; // deleted in the working tree but still in the index
    }
    for (const { name, prefix } of prefixes) {
      if (buf.includes(prefix)) hits.push({ where: relative(root, file) || file, name });
    }
  }
  return hits;
}

function scanHistory(root, prefixes) {
  const hits = [];
  for (const { name, prefix } of prefixes) {
    let out;
    try {
      // -S finds commits that add or remove the string; --all covers every ref.
      out = execFileSync("git", ["log", "--all", "--format=%h", "-S", prefix], { cwd: root }).toString().trim();
    } catch {
      continue; // no commits yet
    }
    for (const sha of out.split("\n").filter(Boolean)) hits.push({ where: `commit ${sha}`, name });
  }
  return hits;
}

const args = parseArgs(process.argv.slice(2));
const prefixes = keyPrefixes();

if (prefixes.length === 0) {
  if (process.env.KEY_LEAK_REQUIRE === "1") {
    console.error("key-leak check: no API key in the environment, but KEY_LEAK_REQUIRE=1. Failing.");
    process.exit(1);
  }
  console.warn("key-leak check: skipped (no BOLD_TEST_API_KEY or BOLD_API_KEY in the environment).");
  process.exit(0);
}

const files = args.paths.length > 0 ? args.paths.flatMap((p) => (statSync(p).isDirectory() ? walk(p) : [p])) : gitFiles(args.root);
const hits = scanFiles(files, prefixes, args.root);
if (args.history) hits.push(...scanHistory(args.root, prefixes));

if (hits.length > 0) {
  console.error(`key-leak check: FAILED. The first ${PREFIX_LENGTH} characters of an API key were found in:`);
  for (const h of hits) console.error(`  - ${h.where} (key from ${h.name})`);
  console.error("Remove the key from these files (and rewrite history if a commit is listed), then rotate the key.");
  process.exit(1);
}

console.log(
  `key-leak check: passed (${files.length} files${args.history ? " and full history" : ""}, ${prefixes.length} key${prefixes.length === 1 ? "" : "s"}).`,
);
