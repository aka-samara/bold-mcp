import { createServer, type Server } from "node:http";

/**
 * Minimal Prometheus metrics (text exposition format), served on a separate
 * private port (`BOLD_METRICS_PORT`). Labels are low-cardinality only: no key
 * fingerprints, connection ids or arguments (per-key views come from the
 * usage_log table).
 */
type Labels = Record<string, string>;
const key = (l: Labels) =>
  Object.keys(l)
    .sort()
    .map((k) => `${k}="${String(l[k]).replace(/["\\\n]/g, "_")}"`)
    .join(",");

class Counter {
  readonly values = new Map<string, number>();
  constructor(readonly name: string, readonly help: string) {}
  inc(labels: Labels = {}, by = 1) {
    const k = key(labels);
    this.values.set(k, (this.values.get(k) ?? 0) + by);
  }
  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} counter`];
    for (const [k, v] of this.values) lines.push(`${this.name}${k ? `{${k}}` : ""} ${v}`);
    return lines.join("\n");
  }
}

class Histogram {
  private readonly series = new Map<string, { counts: number[]; sum: number; count: number }>();
  constructor(readonly name: string, readonly help: string, readonly buckets: number[]) {}
  observe(labels: Labels, value: number) {
    const k = key(labels);
    const s = this.series.get(k) ?? { counts: this.buckets.map(() => 0), sum: 0, count: 0 };
    this.series.set(k, s);
    this.buckets.forEach((b, i) => {
      if (value <= b) s.counts[i] = (s.counts[i] ?? 0) + 1;
    });
    s.sum += value;
    s.count++;
  }
  render(): string {
    const lines = [`# HELP ${this.name} ${this.help}`, `# TYPE ${this.name} histogram`];
    for (const [k, s] of this.series) {
      const sep = k ? `${k},` : "";
      this.buckets.forEach((b, i) => lines.push(`${this.name}_bucket{${sep}le="${b}"} ${s.counts[i]}`));
      lines.push(`${this.name}_bucket{${sep}le="+Inf"} ${s.count}`, `${this.name}_sum${k ? `{${k}}` : ""} ${s.sum}`, `${this.name}_count${k ? `{${k}}` : ""} ${s.count}`);
    }
    return lines.join("\n");
  }
}

const LATENCY_BUCKETS = [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 25];

export class Metrics {
  readonly toolCalls = new Counter("bold_tool_calls_total", "Tool calls by tool, outcome and auth mode");
  readonly toolDuration = new Histogram("bold_tool_call_duration_seconds", "Tool call latency (server and upstream)", LATENCY_BUCKETS);
  readonly creditsUsed = new Counter("bold_credits_used_total", "Credits used (server estimate) by tool and pool");
  readonly rateLimited = new Counter("bold_rate_limited_total", "Calls stopped by a local rate limit, by scope");
  readonly unlocks = new Counter("bold_unlocks_total", "Contact and KYB unlocks that returned data");
  readonly connectAttempts = new Counter("bold_connect_attempts_total", "Connect-page key submissions by result");
  readonly tokenRequests = new Counter("bold_token_requests_total", "Token endpoint requests by grant type and result");
  readonly tokenDuration = new Histogram("bold_token_duration_seconds", "Token endpoint latency", LATENCY_BUCKETS);
  readonly keyValidations = new Counter("bold_key_validations_total", "Header-mode key checks against Credit Usage, by result");
  readonly kmsErrors = new Counter("bold_kms_errors_total", "Key vault (KMS) failures");
  private readonly gauges = new Map<string, { help: string; read: () => number }>();

  gauge(name: string, help: string, read: () => number) {
    this.gauges.set(name, { help, read });
  }

  render(): string {
    const parts = [this.toolCalls, this.toolDuration, this.creditsUsed, this.rateLimited, this.unlocks, this.connectAttempts, this.tokenRequests, this.tokenDuration, this.keyValidations, this.kmsErrors].map((m) => m.render());
    for (const [name, g] of this.gauges) parts.push(`# HELP ${name} ${g.help}\n# TYPE ${name} gauge\n${name} ${g.read()}`);
    return `${parts.join("\n")}\n`;
  }

  /** Serve /metrics on its own port (keep it off the public load balancer). */
  listen(port: number, host = "0.0.0.0"): Server {
    return createServer((req, res) => {
      if (req.url !== "/metrics") return void res.writeHead(404).end();
      res.writeHead(200, { "content-type": "text/plain; version=0.0.4" }).end(this.render());
    }).listen(port, host);
  }
}
