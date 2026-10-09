import { describe, expect, it } from "vitest";
import { extractRows, extractTotal, normalizeFlat, pageInfo, toIsoDate, toIsoDateTime, toNumber, truncate } from "@bold-mcp/core";

describe("normalisers", () => {
  it("maps empty markers to null", () => {
    expect(normalizeFlat({ a: "", b: "-", c: null, d: "x" })).toEqual({ a: null, b: null, c: null, d: "x" });
  });

  it("converts numeric strings to numbers but keeps ids and codes as strings", () => {
    expect(normalizeFlat({ amount: "12500.00", weight: "3,400.5", hs_code: "940360", id: "123", bill_of_lading_nbr: "0001", import_id: "77" })).toEqual({
      amount: 12500,
      weight: 3400.5,
      hs_code: "940360",
      id: "123",
      bill_of_lading_nbr: "0001",
      import_id: "77",
    });
  });

  it("drops *_cn fields unless language is zh", () => {
    expect(normalizeFlat({ label: "x", label_cn: "中" })).toEqual({ label: "x" });
    expect(normalizeFlat({ label: "x", label_cn: "中" }, "zh")).toEqual({ label: "x", label_cn: "中" });
  });

  it("normalises dates", () => {
    expect(toIsoDate("20260815")).toBe("2026-08-15");
    expect(toIsoDate("2026-08-15 10:00:00")).toBe("2026-08-15");
    expect(toIsoDate("2026/08/15")).toBe("2026-08-15");
    expect(toIsoDate("soon")).toBeNull();
    expect(normalizeFlat({ bydate: "20260815" })).toEqual({ bydate: "2026-08-15" });
    expect(toIsoDateTime("2026-10-07 12:00:00")).toBe("2026-10-07T12:00:00Z");
  });

  it("parses numbers defensively", () => {
    expect(toNumber("-")).toBeNull();
    expect(toNumber("1e5")).toBeNull();
    expect(toNumber(Number.NaN)).toBeNull();
    expect(toNumber(" 42 ")).toBe(42);
  });

  it("truncates to 200 characters and flags it", () => {
    const long = "A".repeat(300);
    const t = truncate(long);
    expect(t.truncated).toBe(true);
    expect(t.text?.length).toBe(200);
    expect(truncate("short")).toEqual({ text: "short", truncated: false });
  });

  it("finds rows and totals in different list wrappers", () => {
    expect(extractRows([1, 2])).toEqual([1, 2]);
    expect(extractRows({ total: 3, list: [1] })).toEqual([1]);
    expect(extractRows({ records: [1, 2] })).toEqual([1, 2]);
    expect(extractRows(null)).toEqual([]);
    expect(extractTotal({ total_records: "37" })).toBe(37);
  });

  it("computes has_more from total or a full page", () => {
    expect(pageInfo({ total: 25 }, 10, 2, 10).has_more).toBe(true);
    expect(pageInfo({ total: 20 }, 10, 2, 10).has_more).toBe(false);
    expect(pageInfo([], 10, 1, 10).has_more).toBe(true);
    expect(pageInfo([], 3, 1, 10).has_more).toBe(false);
  });
});
