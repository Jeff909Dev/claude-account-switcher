import { beforeEach, describe, expect, it, vi } from "vitest";
import { RescueTracker, openAs, probe } from "../../src/background/rescue";
import { createHarness, saveAccount, type Harness } from "./harness";

const PAGE = "https://claude.ai/artifact/7f3c";
const API = "https://claude.ai/api/organizations/org-a/artifacts/7f3c?x=1";

describe("RescueTracker", () => {
  let h: Harness;
  let tracker: RescueTracker;
  const pageUrlOf = async (_tabId: number): Promise<string | undefined> => PAGE;

  beforeEach(async () => {
    h = await createHarness();
    for (const l of ["A", "B", "C"] as const) await saveAccount(h, l);
    await h.store.setActive("acct-a");
    await h.store.setStatus("acct-c", "signedOut");
    tracker = new RescueTracker(h.store);
  });

  it("notifies once when the page's own API call about its resource 404s", async () => {
    expect(await tracker.onApiCompleted({ tabId: 7, url: API, statusCode: 404 }, pageUrlOf)).toBe(7);
    expect(await tracker.onApiCompleted({ tabId: 7, url: API, statusCode: 404 }, pageUrlOf)).toBeNull();
    expect(tracker.miss(7)).toMatchObject({ ref: { key: "artifact:7f3c" }, apiUrl: API, pageUrl: PAGE });
  });

  it("ignores unrelated or successful calls and extension requests", async () => {
    expect(await tracker.onApiCompleted({ tabId: 7, url: API, statusCode: 200 }, pageUrlOf)).toBeNull();
    expect(await tracker.onApiCompleted({ tabId: 7, url: API, statusCode: 500 }, pageUrlOf)).toBeNull();
    expect(await tracker.onApiCompleted({ tabId: 7, url: "https://claude.ai/api/notifications", statusCode: 404 }, pageUrlOf)).toBeNull();
    expect(await tracker.onApiCompleted({ tabId: -1, url: API, statusCode: 404 }, pageUrlOf)).toBeNull();
    expect(await tracker.onApiCompleted({ tabId: 8, url: API, statusCode: 404 }, async () => "https://claude.ai/new")).toBeNull();
  });

  it("forgets a tab's miss when it reloads, navigates elsewhere or closes", async () => {
    await tracker.onApiCompleted({ tabId: 7, url: API, statusCode: 404 }, pageUrlOf);
    tracker.onTabUpdated(7, { url: PAGE });
    expect(tracker.miss(7)).toBeDefined();
    tracker.onTabUpdated(7, { status: "loading" });
    expect(tracker.miss(7)).toBeUndefined();
    await tracker.onApiCompleted({ tabId: 7, url: API, statusCode: 404 }, pageUrlOf);
    tracker.onTabUpdated(7, { url: "https://claude.ai/new" });
    expect(tracker.miss(7)).toBeUndefined();
    await tracker.onApiCompleted({ tabId: 7, url: API, statusCode: 404 }, pageUrlOf);
    tracker.onTabRemoved(7);
    expect(tracker.miss(7)).toBeUndefined();
  });

  it("offers the other accounts, remembered one first, without cookies", async () => {
    await h.store.rememberResource("artifact:7f3c", "acct-c");
    await tracker.onApiCompleted({ tabId: 7, url: API, statusCode: 404 }, pageUrlOf);
    const info = (await tracker.info(7))!;
    expect(info).toMatchObject({ resourceKey: "artifact:7f3c", kind: "artifact", currentAccountId: "acct-a", rememberedAccountId: "acct-c" });
    expect(info.candidates.map((a) => a.id)).toEqual(["acct-c", "acct-b"]);
    expect(JSON.stringify(info)).not.toContain("sessionKey");
    expect(await tracker.info(99)).toBeNull();
  });
});

describe("openAs", () => {
  it("remembers the mapping and switches", async () => {
    const h = await createHarness();
    await saveAccount(h, "B");
    const switchTo = vi.fn(async (id: string) => ({ status: "switched" as const, accountId: id, reloadedTabs: 1 }));
    expect(await openAs(h.store, switchTo, "artifact:7f3c", "acct-b")).toMatchObject({ status: "switched" });
    expect(switchTo).toHaveBeenCalledWith("acct-b");
    expect(await h.store.resourceAccount("artifact:7f3c")).toBe("acct-b");
  });
});

describe("probe", () => {
  it("asks each other account through a scoped DNR cookie rule and cleans up", async () => {
    const h = await createHarness();
    for (const l of ["A", "B", "C"] as const) await saveAccount(h, l);
    await h.store.setActive("acct-a");
    await h.store.setStatus("acct-c", "signedOut");
    const rulesSeen: unknown[] = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      rulesSeen.push(...(await chrome.declarativeNetRequest.getSessionRules()));
      expect(init?.credentials).toBe("omit");
      return new Response("{}", { status: url.includes("/organizations/org-b/") ? 200 : 404 });
    });
    const miss = { ref: { kind: "artifact" as const, id: "7f3c", key: "artifact:7f3c" }, apiUrl: API, pageUrl: PAGE };
    expect(await probe(h.store, miss, fetchImpl)).toEqual([
      { accountId: "acct-b", outcome: "found" },
      { accountId: "acct-c", outcome: "signedOut" },
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const url = fetchImpl.mock.calls[0]![0];
    expect(url).toContain("/organizations/org-b/artifacts/7f3c?x=1&cas_probe=");
    expect(JSON.stringify(rulesSeen)).toContain("sessionKey=sk-B");
    expect(JSON.stringify(rulesSeen)).toContain('"tabIds":[-1]');
    expect(h.fake.sessionRules).toEqual([]);
  });

  it("removes the rule even when the request fails", async () => {
    const h = await createHarness();
    await saveAccount(h, "A");
    await saveAccount(h, "B");
    await h.store.setActive("acct-a");
    const miss = { ref: { kind: "artifact" as const, id: "7f3c", key: "artifact:7f3c" }, apiUrl: API, pageUrl: PAGE };
    expect(await probe(h.store, miss, async () => Promise.reject(new TypeError("offline")))).toEqual([{ accountId: "acct-b", outcome: "error" }]);
    expect(h.fake.sessionRules).toEqual([]);
  });

  it("gives concurrent probes distinct rule ids and removes both rules", async () => {
    const h = await createHarness();
    for (const l of ["A", "B"] as const) await saveAccount(h, l);
    await h.store.setActive("acct-a");
    const ids: number[] = [];
    const fetchImpl = async () => {
      const rules = await chrome.declarativeNetRequest.getSessionRules();
      ids.push(...rules.map((r) => r.id));
      await new Promise((r) => setTimeout(r, 5));
      return new Response("{}", { status: 200 });
    };
    const miss = { ref: { kind: "artifact" as const, id: "7f3c", key: "artifact:7f3c" }, apiUrl: API, pageUrl: PAGE };
    await Promise.all([probe(h.store, miss, fetchImpl), probe(h.store, miss, fetchImpl)]);
    expect(new Set(ids).size).toBe(2);
    expect(h.fake.sessionRules).toEqual([]);
  });
});
