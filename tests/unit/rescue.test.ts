import { beforeEach, describe, expect, it, vi } from "vitest";
import { RescueTracker, openAs } from "../../src/background/rescue";
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
    expect(tracker.miss(7)).toEqual({ ref: { kind: "artifact", id: "7f3c", key: "artifact:7f3c" } });
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
