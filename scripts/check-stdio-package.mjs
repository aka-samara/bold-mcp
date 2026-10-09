// Pack the stdio package, install the tarball in a temp project and check it
// starts and lists all 18 tools (what `npx @billofladingdata/mcp` will run).
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const pkg = fileURLToPath(new URL("../packages/stdio", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "bold-stdio-"));
execFileSync("npm", ["pack", "--pack-destination", dir], { cwd: pkg, stdio: "ignore" });
const tgz = readdirSync(dir).find((f) => f.endsWith(".tgz"));
writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "stdio-check", private: true }));
execFileSync("npm", ["install", "--no-audit", "--no-fund", `./${tgz}`], { cwd: dir, stdio: "ignore" });

const child = spawn(join(dir, "node_modules/.bin/bold-mcp"), [], { env: { ...process.env, BOLD_API_KEY: "stdio-package-check-key-00000000" }, stdio: ["pipe", "pipe", "inherit"] });
const send = (m) => child.stdin.write(`${JSON.stringify(m)}\n`);
let buf = "";
const timer = setTimeout(() => {
  console.error("FAIL: no tools/list answer within 15 s");
  child.kill();
  process.exit(1);
}, 15_000);
child.stdout.on("data", (d) => {
  buf += d;
  for (const line of buf.split("\n").slice(0, -1)) {
    const m = JSON.parse(line);
    if (m.id === 1) {
      send({ jsonrpc: "2.0", method: "notifications/initialized" });
      send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    }
    if (m.id === 2) {
      clearTimeout(timer);
      const n = m.result.tools.length;
      console.log(`${n === 18 ? "PASS" : "FAIL"}: packed stdio package lists ${n} tools`);
      child.kill();
      process.exit(n === 18 ? 0 : 1);
    }
  }
  buf = buf.slice(buf.lastIndexOf("\n") + 1);
});
send({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "check", version: "1" } } });
