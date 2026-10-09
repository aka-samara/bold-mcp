// Operator commands. Needs DATABASE_URL.
//   bold-mcp-admin migrate
//   bold-mcp-admin revoke-fingerprint <key fingerprint>   (a leaked or rotated key: revoke every connection using it)
//   bold-mcp-admin expire-unused [--days 90]              (run daily: revoke connections idle for N days)
//   bold-mcp-admin audit [--fingerprint <fp>] [--subject <contact or kyb id>] [--limit 100]
//   bold-mcp-admin reconcile [--hours 24] [--sample 20]   (run nightly: server estimates vs Credit Usage Logs; exit 1 on mismatch)
//   bold-mcp-admin report [--days 7]                      (weekly usage report as JSON)
//   bold-mcp-admin spend-check [--hours 1] [--limit 5000] (run hourly: exit 1 if any key spent more through MCP)
import { createLogger, extractRows, PartnerApiClient, toIsoDateTime } from "@bold-mcp/core";
import { loadHttpConfig } from "./config.js";
import { migrate, PostgresDb } from "./db/postgres.js";
import { buildServices } from "./services.js";

const [cmd, ...args] = process.argv.slice(2);
const opt = (n: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const url = process.env.DATABASE_URL;
if (!url) {
  process.stderr.write("DATABASE_URL is not set.\n");
  process.exit(2);
}
const db = PostgresDb.fromUrl(url);
try {
  switch (cmd) {
    case "migrate": {
      const applied = await migrate(db.pool);
      process.stdout.write(applied.length ? `Applied: ${applied.join(", ")}\n` : "Up to date.\n");
      break;
    }
    case "revoke-fingerprint": {
      const fp = args[0];
      if (!fp || !/^[0-9a-f]{12}$/.test(fp)) throw new Error("Usage: revoke-fingerprint <12-hex key fingerprint>");
      await migrate(db.pool);
      process.stdout.write(`Revoked ${await db.connections.revokeByFingerprint(fp, "admin: key revoked")} connection(s).\n`);
      break;
    }
    case "expire-unused": {
      const i = args.indexOf("--days");
      const days = i >= 0 ? Number(args[i + 1]) : Number(process.env.BOLD_CONNECTION_IDLE_DAYS ?? 90);
      if (!Number.isInteger(days) || days < 1) throw new Error("--days must be a positive whole number");
      await migrate(db.pool);
      process.stdout.write(`Expired ${await db.connections.expireUnused(new Date(Date.now() - days * 86_400_000))} connection(s) unused for ${days} days.\n`);
      break;
    }
    case "audit": {
      const val = opt;
      await migrate(db.pool);
      const fp = val("fingerprint");
      const subject = val("subject");
      const rows = await db.audit.list({ ...(fp ? { keyFingerprint: fp } : {}), ...(subject ? { subjectId: subject } : {}), limit: Number(val("limit") ?? 100) });
      for (const r of rows) process.stdout.write(`${JSON.stringify(r)}\n`);
      break;
    }
    case "report": {
      await migrate(db.pool);
      const days = Number(opt("days") ?? 7);
      process.stdout.write(`${JSON.stringify(await db.usage.summary(new Date(Date.now() - days * 86_400_000)), null, 2)}\n`);
      break;
    }
    case "spend-check": {
      await migrate(db.pool);
      const hours = Number(opt("hours") ?? 1);
      const limit = Number(opt("limit") ?? 5000);
      const heavy = await db.usage.heavySpenders(new Date(Date.now() - hours * 3_600_000), limit);
      for (const h of heavy) process.stdout.write(`${JSON.stringify({ ...h, hours, limit })}\n`);
      process.stdout.write(`${heavy.length} key(s) above ${limit} credits in ${hours} h.\n`);
      if (heavy.length) process.exitCode = 1;
      break;
    }
    case "reconcile": {
      const hours = Number(opt("hours") ?? 24);
      const since = new Date(Date.now() - hours * 3_600_000);
      const config = loadHttpConfig();
      const logger = createLogger({ level: "warn", name: "bold-mcp-admin" });
      const services = await buildServices(config, logger, { db });
      const client = new PartnerApiClient({ baseUrl: config.BOLD_API_BASE_URL, timeoutMs: 20_000, maxRetries: 2 });
      const seen = new Set<string>();
      let mismatches = 0;
      for (const conn of await db.connections.sampleActive(since, Number(opt("sample") ?? 20))) {
        if (seen.has(conn.keyFingerprint)) continue;
        seen.add(conn.keyFingerprint);
        const apiKey = await services.vault.decrypt(conn.encryptedKey, conn.id);
        // Credit Usage Logs (free), newest first, until older than the window.
        const api = { data: 0, contact: 0, kyb: 0 };
        for (let page = 1; page <= 20; page++) {
          const rows = extractRows((await client.call("credit-usage-logs", { page_size: 250, page_no: page }, apiKey)).data) as Record<string, unknown>[];
          let older = false;
          for (const r of rows) {
            const at = toIsoDateTime(r.created_at);
            if (at && new Date(at) < since) {
              older = true;
              continue;
            }
            const t = String(r.credit_type ?? "").toLowerCase();
            const pool = t.includes("contact") ? "contact" : t.includes("kyb") ? "kyb" : t.includes("data") ? "data" : null;
            if (pool) api[pool] += Number(r.credits_used ?? 0);
          }
          if (older || rows.length < 250) break;
        }
        const mcp = await db.usage.creditsByPool(conn.keyFingerprint, since);
        // The API logs also hold the customer's direct API use, so they can only be higher than the MCP share.
        // MCP estimating more than the API charged is a mismatch.
        for (const pool of ["data", "contact", "kyb"] as const) {
          const bad = mcp[pool] > api[pool];
          if (bad) mismatches++;
          process.stdout.write(`${JSON.stringify({ key_fp: conn.keyFingerprint, pool, mcp_estimated: mcp[pool], api_logged: api[pool], ok: !bad })}\n`);
        }
      }
      services.redis?.disconnect();
      process.stdout.write(`Checked ${seen.size} key(s) over ${hours} h: ${mismatches} mismatch(es).\n`);
      if (mismatches) process.exitCode = 1;
      break;
    }
    default:
      throw new Error("Commands: migrate | revoke-fingerprint <fp> | expire-unused [--days N] | audit [--fingerprint fp] [--subject id] | reconcile [--hours N] [--sample N] | report [--days N] | spend-check [--hours N] [--limit N]");
  }
} catch (err) {
  process.stderr.write(`${err instanceof Error ? err.message : "failed"}\n`);
  process.exitCode = 1;
} finally {
  await db.close();
}
