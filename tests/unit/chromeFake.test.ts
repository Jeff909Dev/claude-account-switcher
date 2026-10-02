import { beforeEach, describe, expect, it } from "vitest";
import { createChromeFake, patternToRegExp, type ChromeFake } from "../fakes/chrome";

describe("chrome fake", () => {
  let fake: ChromeFake;
  beforeEach(() => {
    fake = createChromeFake();
  });

  it("stores host-only and domain cookies like Chrome", async () => {
    await fake.api.cookies.set({ url: "https://claude.ai/", name: "a", value: "1" });
    await fake.api.cookies.set({ url: "https://claude.ai/", name: "b", value: "2", domain: "claude.ai" });
    const all = await fake.api.cookies.getAll({ domain: "claude.ai" });
    expect(all.find((c) => c.name === "a")).toMatchObject({ domain: "claude.ai", hostOnly: true });
    expect(all.find((c) => c.name === "b")).toMatchObject({ domain: ".claude.ai", hostOnly: false });
  });

  it("drops a cookie set with a past expiration", async () => {
    await fake.api.cookies.set({ url: "https://claude.ai/", name: "old", value: "x", expirationDate: Date.now() / 1000 - 10 });
    expect(await fake.api.cookies.getAll({ name: "old" })).toEqual([]);
  });

  it("removes by url + name and emits onChanged", async () => {
    const events: { removed: boolean; name: string }[] = [];
    fake.api.cookies.onChanged.addListener((i) => events.push({ removed: i.removed, name: i.cookie.name }));
    await fake.api.cookies.set({ url: "https://claude.ai/", name: "s", value: "1", domain: ".claude.ai" });
    await fake.api.cookies.remove({ url: "https://claude.ai/", name: "s" });
    expect(await fake.api.cookies.getAll({ domain: "claude.ai" })).toEqual([]);
    expect(events).toEqual([
      { removed: false, name: "s" },
      { removed: true, name: "s" },
    ]);
  });

  it("matches url patterns on any port when the pattern has none", () => {
    expect(patternToRegExp("http://localhost/*").test("http://localhost:4319/new")).toBe(true);
    expect(patternToRegExp("https://claude.ai/*").test("https://claude.ai/chat/x")).toBe(true);
    expect(patternToRegExp("https://claude.ai/*").test("https://evil.example/claude.ai/")).toBe(false);
  });

  it("queries tabs by pattern across windows", async () => {
    fake.addTab("https://claude.ai/new", 1);
    fake.addTab("https://claude.ai/chat/1", 2);
    fake.addTab("https://example.com/", 1);
    const tabs = await fake.api.tabs.query({ url: "https://claude.ai/*" });
    expect(tabs.map((t) => t.windowId).sort()).toEqual([1, 2]);
  });

  it("without the tabs permission, only shows the URLs of tabs the host permission covers, like Chrome", async () => {
    const claude = fake.addTab("https://claude.ai/chat/1");
    const other = fake.addTab("https://example.com/");
    expect((await fake.api.tabs.get(claude.id)).url).toBe("https://claude.ai/chat/1");
    expect((await fake.api.tabs.get(other.id)).url).toBeUndefined();
    expect((await fake.api.tabs.query({})).map((t) => t.url)).toEqual(["https://claude.ai/chat/1", undefined]);
    expect(await fake.api.tabs.query({ url: "https://example.com/*" })).toEqual([]);
    expect((await fake.api.tabs.create({ url: "https://example.com/new" })).url).toBeUndefined();

    const seen: { change: { status?: string; url?: string }; url?: string }[] = [];
    fake.api.tabs.onUpdated.addListener((_id, change, tab) => seen.push({ change, url: tab.url }));
    fake.navigate(claude.id, "https://example.com/next");
    fake.navigate(other.id, "https://claude.ai/new");
    expect(seen).toEqual([
      { change: { status: "loading" }, url: undefined },
      { change: { status: "loading", url: "https://claude.ai/new" }, url: "https://claude.ai/new" },
    ]);
  });

  it("runtime.sendMessage rejects when nobody listens, like Chrome", async () => {
    await expect(fake.api.runtime.sendMessage({ type: "x" })).rejects.toThrow(/Receiving end does not exist/);
  });

  it("storage.get supports string, array and defaults", async () => {
    await fake.api.storage.local.set({ a: 1, b: { c: 2 } });
    expect(await fake.api.storage.local.get("a")).toEqual({ a: 1 });
    expect(await fake.api.storage.local.get(["a", "zz"])).toEqual({ a: 1 });
    expect(await fake.api.storage.local.get({ zz: 9 })).toEqual({ zz: 9 });
  });

  it("records badge and alarms", async () => {
    await fake.api.action.setBadgeText({ text: "91%" });
    await fake.api.action.setBadgeBackgroundColor({ color: "#ff6b80" });
    await fake.api.alarms.create("tick", { periodInMinutes: 15 });
    expect(fake.badge).toEqual({ text: "91%", color: "#ff6b80" });
    expect(await fake.api.alarms.get("tick")).toEqual({ name: "tick", periodInMinutes: 15 });
  });
});
