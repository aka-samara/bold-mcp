import { describe, expect, it } from "vitest";
import { Metrics } from "../../packages/http-server/src/metrics.ts";

describe("metrics", () => {
  it("renders Prometheus text with counters, histograms and gauges", () => {
    const m = new Metrics();
    m.toolCalls.inc({ tool: "search_kyb", outcome: "ok", auth_mode: "oauth" });
    m.toolCalls.inc({ tool: "search_kyb", outcome: "ok", auth_mode: "oauth" });
    m.toolDuration.observe({ tool: "search_kyb" }, 0.2);
    m.gauge("bold_active_sessions", "Open sessions", () => 3);
    const text = m.render();
    expect(text).toContain('bold_tool_calls_total{auth_mode="oauth",outcome="ok",tool="search_kyb"} 2');
    expect(text).toContain('bold_tool_call_duration_seconds_bucket{tool="search_kyb",le="0.25"} 1');
    expect(text).toContain('bold_tool_call_duration_seconds_bucket{tool="search_kyb",le="0.1"} 0');
    expect(text).toContain('bold_tool_call_duration_seconds_count{tool="search_kyb"} 1');
    expect(text).toContain("bold_active_sessions 3");
  });
});
