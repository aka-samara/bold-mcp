// Operator commands. Needs DATABASE_URL.
//   bold-mcp-admin migrate
//   bold-mcp-admin revoke-fingerprint <key fingerprint>   (a leaked or rotated key: revoke every connection using it)
//   bold-mcp-admin expire-unused [--days 90]              (run daily: revoke connections idle for N days)
//   bold-mcp-admin audit [--fingerprint <fp>] [--subject <contact or kyb id>] [--limit 100]
import { migrate, PostgresDb } from "./db/postgres.js";

const [cmd, ...args] = process.argv.slice(2);
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
      const val = (n: string) => {
        const i = args.indexOf(`--${n}`);
        return i >= 0 ? args[i + 1] : undefined;
      };
      await migrate(db.pool);
      const fp = val("fingerprint");
      const subject = val("subject");
      const rows = await db.audit.list({ ...(fp ? { keyFingerprint: fp } : {}), ...(subject ? { subjectId: subject } : {}), limit: Number(val("limit") ?? 100) });
      for (const r of rows) process.stdout.write(`${JSON.stringify(r)}\n`);
      break;
    }
    default:
      throw new Error("Commands: migrate | revoke-fingerprint <fp> | expire-unused [--days N] | audit [--fingerprint fp] [--subject id]");
  }
} catch (err) {
  process.stderr.write(`${err instanceof Error ? err.message : "failed"}\n`);
  process.exitCode = 1;
} finally {
  await db.close();
}
