import { beforeEach, describe, expect, it, vi } from "vitest";
import { BADGE_CRIT, BADGE_WARN, USAGE_KEY, UsageService, badgeFor, parseUsage } from "../../src/background/usage";
import fixture from "../fixtures/usage-limits.json";
import { createHarness, saveAccount, type Harness } from "./harness";

describe("parseUsage", () => {
  it("prefers limits[] and labels them 5h / week / model", () => {
    expect(parseUsage(fixture).map((l) => [l.kind, l.label, l.percent])).toEqual([
      ["session", "5h", 25],
      ["weekly_all", "week", 54],
      ["weekly_scoped", "Fable", 64],
    ]);
  });

  it("falls back to five_hour / seven_day / seven_day_<known model>, skipping nulls and codenames", () => {
    const json = {
      seven_day_opus: { utilization: 70, resets_at: null },
      five_hour: { utilization: 12, resets_at: "2026-10-01T22:30:00Z" },
      seven_day: { utilization: 30 },
      seven_day_sonnet: null,
      seven_day_omelette: { utilization: 5 },
      limits: [],
    };
    expect(parseUsage(json).map((l) => `${l.label} ${l.percent}`)).toEqual(["5h 12", "week 30", "Opus 70"]);
  });

  it("skips limits with null percent or unknown kinds without a model, keeps unknown kinds with one", () => {
    const json = {
      limits: [
        { kind: "session", percent: null },
        { kind: "mystery", percent: 40 },
        { kind: "weekly_surface", percent: 41, scope: { model: { display_name: "Haiku" } } },
        { kind: "weekly_all", percent: 150 },
      ],
    };
    expect(parseUsage(json)).toEqual([
      { kind: "weekly_all", label: "week", percent: 100, resetsAt: null },
      { kind: "weekly_surface", label: "Haiku", percent: 41, resetsAt: null },
    ]);
  });

  it.each([null, undefined, "x", 42, {}, { limits: "nope" }])("returns [] for %j", (json) => expect(parseUsage(json)).toEqual([]));
});

describe("badgeFor", () => {
  const snap = (...p: number[]) => ({ fetchedAt: 0, limits: p.map((percent) => ({ kind: "x", label: "x", percent, resetsAt: null })) });
  it.each([
    [snap(10, 69), true, { text: "", color: null }],
    [snap(10, 70), true, { text: "70%", color: BADGE_WARN }],
    [snap(91.6, 20), true, { text: "92%", color: BADGE_CRIT }],
    [snap(95), false, { text: "", color: null }],
    [undefined, true, { text: "", color: null }],
  ])("%j / %s", (s, enabled, expected) => expect(badgeFor(s, enabled)).toEqual(expected));
});

describe("UsageService", () => {
  let h: Harness;
  let fetchUsage: ReturnType<typeof vi.fn<(org: string) => Promise<unknown>>>;
  let setBadge: ReturnType<typeof vi.fn<(text: string, color: string | null) => Promise<void>>>;
  let usage: UsageService;

  beforeEach(async () => {
    h = await createHarness();
    await saveAccount(h, "A");
    await saveAccount(h, "B");
    await h.store.setActive("acct-a");
    fetchUsage = vi.fn<(org: string) => Promise<unknown>>(async () => fixture);
    setBadge = vi.fn<(text: string, color: string | null) => Promise<void>>(async () => undefined);
    usage = new UsageService({ store: h.store, area: h.fake.chrome.storage.local, fetchUsage, now: () => h.now.value, setBadge });
  });

  it("fetches the active org and stores a snapshot", async () => {
    expect(await usage.refreshActive()).toBe(true);
    expect(fetchUsage).toHaveBeenCalledWith("org-a");
    const all = await usage.all();
    expect(all["acct-a"]).toMatchObject({ fetchedAt: h.now.value });
    expect(all["acct-a"]!.limits).toHaveLength(3);
    expect(setBadge).toHaveBeenLastCalledWith("", null);
  });

  it("skips the fetch while the snapshot is fresh", async () => {
    await usage.refreshActive();
    h.now.value += 30_000;
    expect(await usage.refreshActive(60_000)).toBe(false);
    h.now.value += 31_000;
    expect(await usage.refreshActive(60_000)).toBe(true);
    expect(fetchUsage).toHaveBeenCalledTimes(2);
  });

  it("keeps the last snapshot of an account after switching away", async () => {
    await usage.refreshActive();
    await h.store.setActive("acct-b");
    fetchUsage.mockResolvedValueOnce({ five_hour: { utilization: 91 } });
    await usage.refreshActive();
    const all = await usage.all();
    expect(Object.keys(all).sort()).toEqual(["acct-a", "acct-b"]);
    expect(setBadge).toHaveBeenLastCalledWith("91%", BADGE_CRIT);
  });

  it("keeps the old snapshot when the fetch fails and skips signed-out accounts", async () => {
    await usage.refreshActive();
    fetchUsage.mockRejectedValueOnce(new Error("offline"));
    h.now.value += 120_000;
    expect(await usage.refreshActive()).toBe(false);
    expect((await usage.all())["acct-a"]).toBeDefined();
    await h.store.setStatus("acct-a", "signedOut");
    expect(await usage.refreshActive()).toBe(false);
  });

  it("prunes snapshots of removed accounts and respects the badge pref", async () => {
    await h.fake.api.storage.local.set({ [USAGE_KEY]: { ghost: { limits: [], fetchedAt: 1 } } });
    await h.store.updatePrefs({ badge: false });
    fetchUsage.mockResolvedValueOnce({ five_hour: { utilization: 95 } });
    await usage.refreshActive();
    expect(Object.keys(await usage.all())).toEqual(["acct-a"]);
    expect(setBadge).toHaveBeenLastCalledWith("", null);
  });

  it("forget deletes one account's snapshot and keeps the others", async () => {
    const snap = { limits: [], fetchedAt: 1 };
    await h.fake.api.storage.local.set({ [USAGE_KEY]: { "acct-a": snap, "acct-b": snap } });
    await usage.forget("acct-b");
    expect(await usage.all()).toEqual({ "acct-a": snap });
    await usage.forget("ghost");
    expect(await usage.all()).toEqual({ "acct-a": snap });
  });

  it.each([
    ["a raw SyntaxError", () => Promise.reject(new SyntaxError("Unexpected token <"))],
    ["an auth error", () => Promise.reject(Object.assign(new Error("403"), { status: 403 }))],
    ["a body with no usable limits", () => Promise.resolve({ unexpected: true })],
  ])("never wipes or crashes on %s", async (_name, fail) => {
    await usage.refreshActive();
    const before = (await usage.all())["acct-a"];
    fetchUsage.mockImplementationOnce(fail);
    h.now.value += 120_000;
    await expect(usage.refreshActive()).resolves.toBe(false);
    expect((await usage.all())["acct-a"]).toEqual(before);
  });
});
