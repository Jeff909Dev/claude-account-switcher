import { describe, expect, it } from "vitest";
import { formatAge, formatReset, levelOf, resetTitle } from "../../src/shared/usageFormat";

describe("usageFormat", () => {
  it.each([
    [0, "ok"], [69.9, "ok"], [70, "warn"], [89, "warn"], [90, "crit"], [100, "crit"],
  ] as const)("levelOf(%s) = %s", (p, l) => expect(levelOf(p)).toBe(l));

  it.each([
    [10_000, "just now"], [5 * 60_000, "5m ago"], [2 * 3_600_000, "2h ago"], [50 * 3_600_000, "2d ago"],
  ])("formatAge(%s) = %s", (ms, text) => expect(formatAge(ms)).toBe(text));

  it("formats resets", () => {
    const now = Date.parse("2026-10-01T20:00:00Z");
    expect(formatReset("2026-10-01T22:30:00Z", now)).toBe("in 2h 30m");
    expect(formatReset("2026-10-01T20:20:00Z", now)).toBe("in 20m");
    expect(formatReset("2026-10-06T04:00:00Z", now)).toMatch(/^[A-Z][a-z]{2} \d{2}:\d{2}$/);
    expect(formatReset(null, now)).toBe("");
    expect(formatReset("garbage", now)).toBe("");
  });

  it("builds the hover title", () => {
    const now = Date.parse("2026-10-01T20:00:00Z");
    expect(
      resetTitle([{ kind: "session", label: "5h", percent: 25, resetsAt: "2026-10-01T22:30:00Z" }, { kind: "weekly_all", label: "week", percent: 54, resetsAt: null }], now),
    ).toBe("5h resets in 2h 30m");
  });
});
