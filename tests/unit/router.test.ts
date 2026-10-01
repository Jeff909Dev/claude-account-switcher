import { beforeEach, describe, expect, it, vi } from "vitest";
import { AddAccountFlow } from "../../src/background/addAccount";
import { RescueTracker } from "../../src/background/rescue";
import { broadcastPush, buildUiState, createRouter, isRequest, type RouterDeps } from "../../src/background/router";
import { Switcher } from "../../src/background/switcher";
import type { Request } from "../../src/shared/messages";
import type { UiState } from "../../src/shared/types";
import { browserAs, createHarness, currentSession, saveAccount, type Harness } from "./harness";

const flush = () => new Promise((r) => setTimeout(r, 0));
/** popup.html opened in a tab (as the e2e test does): an extension page, not a content script. */
const POPUP_IN_TAB = { tab: { id: 9 }, url: "chrome-extension://fakeextensionid/popup.html" };
/** The content script on tab 1, which shows an artifact. */
const ARTIFACT_PAGE = { tab: { id: 1 }, url: "https://claude.ai/artifact/7f3c" };

describe("router", () => {
  let h: Harness;
  let deps: RouterDeps;
  let handle: ReturnType<typeof createRouter>;
  let broadcast: ReturnType<typeof vi.fn<() => Promise<void>>>;
  let refreshActive: ReturnType<typeof vi.fn<(maxAgeMs?: number) => Promise<boolean>>>;

  /** Holds the Switcher's identity check for `org` until released, so a switch stays mid-verification. */
  function holdIdentityCheck(org: string): () => void {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const real = h.whoAmI.getMockImplementation()!;
    h.whoAmI.mockImplementation(async (o) => {
      if (o === org) await gate;
      return real(o);
    });
    return release;
  }

  beforeEach(async () => {
    h = await createHarness();
    await saveAccount(h, "A");
    await saveAccount(h, "B");
    await browserAs(h, "sk-A-live");
    await h.store.setActive("acct-a");
    h.fake.addTab("https://claude.ai/artifact/7f3c"); // tab 1
    broadcast = vi.fn<() => Promise<void>>(async () => undefined);
    refreshActive = vi.fn<(maxAgeMs?: number) => Promise<boolean>>(async () => true);
    const switcher = new Switcher(h.deps, () => void broadcast());
    const addFlow = new AddAccountFlow({
      ...h.deps,
      session: h.fake.chrome.storage.session,
      openLoginTab: async (url) => h.fake.addTab(url, 1, true).id,
      closeTab: (id) => h.fake.api.tabs.remove(id),
    });
    deps = {
      store: h.store,
      switcher,
      addFlow,
      rescue: new RescueTracker(h.store),
      usage: { all: async () => ({ "acct-a": { limits: [], fetchedAt: 1 }, ghost: { limits: [], fetchedAt: 1 } }), refreshActive, updateBadge: vi.fn(async () => undefined) },
      probe: vi.fn(async () => []),
      broadcast,
      lastSwitch: () => null,
      lastError: () => null,
    };
    handle = createRouter(deps);
  });

  it("getState never exposes cookies and only lists known accounts' usage", async () => {
    const r = await handle({ type: "getState" }, {});
    expect(r.ok).toBe(true);
    const state = (r as { data: UiState }).data;
    expect(state.accounts.map((a) => a.id)).toEqual(["acct-a", "acct-b"]);
    expect(JSON.stringify(state)).not.toMatch(/sk-A|sk-B|cookies/);
    expect(Object.keys(state.usage)).toEqual(["acct-a"]);
    await vi.waitFor(() => expect(refreshActive).toHaveBeenCalledWith(60_000));
  });

  it("refreshes usage when the popup opens, not on every claude.ai page load", async () => {
    await handle({ type: "getState" }, { tab: { id: 1 }, url: "https://claude.ai/artifact/7f3c" });
    await flush();
    expect(refreshActive).not.toHaveBeenCalled();
    await handle({ type: "getState" }, {});
    await vi.waitFor(() => expect(broadcast).toHaveBeenCalledTimes(1)); // fresh numbers reach the open popup
    await handle({ type: "getState" }, POPUP_IN_TAB);
    await vi.waitFor(() => expect(refreshActive).toHaveBeenCalledTimes(2));
  });

  describe("never refreshes usage while the browser may hold another account's login", () => {
    it("skips the refresh while an add flow waits for a login or a mismatch answer", async () => {
      await handle({ type: "addAccount:start", targetAccountId: "acct-b" }, {});
      await handle({ type: "getState" }, {});
      await flush();
      await browserAs(h, "sk-C");
      await deps.addFlow.onCookieChanged({ removed: false, cookie: { name: "sessionKey", domain: ".claude.ai" } });
      expect((await deps.addFlow.state()).phase).toBe("mismatch");
      await handle({ type: "getState" }, {});
      await flush();
      expect(refreshActive).not.toHaveBeenCalled();
    });

    it("waits for a running switch to finish", async () => {
      const release = holdIdentityCheck("org-b");
      const switched = deps.switcher.switchTo("acct-b");
      await vi.waitFor(() => expect(h.whoAmI).toHaveBeenCalledWith("org-b"));
      await handle({ type: "getState" }, {});
      await flush();
      expect(refreshActive).not.toHaveBeenCalled();
      release();
      await switched;
      await vi.waitFor(() => expect(refreshActive).toHaveBeenCalledWith(60_000));
    });
  });

  it("answers every failure with { ok: false } instead of leaving the sender waiting", async () => {
    vi.spyOn(h.store, "rename").mockRejectedValue(new Error("Storage is full"));
    expect(await handle({ type: "account:update", accountId: "acct-b", patch: { label: "Home" } }, {})).toEqual({
      ok: false,
      error: "Storage is full",
    });
    expect(await handle({ type: "account:reorder" } as unknown as Request, {})).toMatchObject({ ok: false });
  });

  it("lets claude.ai pages send only in-page requests; the popup may send anything", async () => {
    const page = { tab: { id: 1 }, url: "https://claude.ai/artifact/7f3c" };
    expect(await handle({ type: "prefs:update", patch: { rescueProbe: true } }, page)).toMatchObject({ ok: false });
    expect(await handle({ type: "account:remove", accountId: "acct-b" }, page)).toMatchObject({ ok: false });
    expect(await handle({ type: "account:remove", accountId: "acct-b" }, { tab: { id: 1 } })).toMatchObject({ ok: false });
    let s = await h.store.load();
    expect(s.order).toEqual(["acct-a", "acct-b"]);
    expect(s.prefs.rescueProbe).toBe(false);
    expect(await handle({ type: "rescue:get" }, page)).toEqual({ ok: true, data: null });

    expect(await handle({ type: "prefs:update", patch: { rescueProbe: true } }, {})).toEqual({ ok: true, data: null });
    expect(await handle({ type: "account:remove", accountId: "acct-b" }, POPUP_IN_TAB)).toEqual({ ok: true, data: null });
    s = await h.store.load();
    expect(s.order).toEqual(["acct-a"]);
    expect(s.prefs.rescueProbe).toBe(true);
  });

  it("switch returns at once and finishes in the background (popup may close)", async () => {
    expect(await handle({ type: "switch", accountId: "acct-b" }, {})).toEqual({ ok: true, data: null });
    await deps.switcher.idle();
    expect((await h.store.load()).activeId).toBe("acct-b");
    expect(broadcast).toHaveBeenCalled();
  });

  it("switch cancels a pending add flow first", async () => {
    await handle({ type: "addAccount:start" }, {});
    expect(await deps.addFlow.isWaiting()).toBe(true);
    await handle({ type: "switch", accountId: "acct-b" }, {});
    await deps.switcher.idle();
    expect(await deps.addFlow.isWaiting()).toBe(false);
    expect(await currentSession(h)).toBe("sk-B");
  });

  it("account and pref mutations persist and broadcast", async () => {
    await handle({ type: "account:update", accountId: "acct-b", patch: { label: "Personal", color: 3 } }, {});
    await handle({ type: "account:reorder", order: ["acct-b", "acct-a"] }, {});
    await handle({ type: "prefs:update", patch: { badge: false } }, {});
    const s = await h.store.load();
    expect(s.accounts["acct-b"]).toMatchObject({ label: "Personal", color: 3 });
    expect(s.order).toEqual(["acct-b", "acct-a"]);
    expect(s.prefs.badge).toBe(false);
    expect(deps.usage.updateBadge).toHaveBeenCalled();
    expect(broadcast).toHaveBeenCalledTimes(3);
  });

  it("rescue:get answers for the sender's tab; openAs remembers and switches", async () => {
    await deps.rescue.onApiCompleted(
      { tabId: 1, url: "https://claude.ai/api/organizations/org-a/artifacts/7f3c", statusCode: 404 },
      async () => "https://claude.ai/artifact/7f3c",
    );
    const r = await handle({ type: "rescue:get" }, { tab: { id: 1 } });
    expect(r).toMatchObject({ ok: true, data: { resourceKey: "artifact:7f3c" } });
    expect(await handle({ type: "rescue:get" }, {})).toEqual({ ok: true, data: null });
    await handle({ type: "rescue:openAs", accountId: "acct-b", resourceKey: "artifact:7f3c" }, ARTIFACT_PAGE);
    await vi.waitFor(async () => expect(await h.store.resourceAccount("artifact:7f3c")).toBe("acct-b"));
    await vi.waitFor(async () => expect((await h.store.load()).activeId).toBe("acct-b"));
  });

  it("rescue:openAs only remembers the resource the sender's page shows", async () => {
    for (const [resourceKey, sender] of [
      ["artifact:other", ARTIFACT_PAGE],
      ["artifact:7f3c", { tab: { id: 1 }, url: "https://claude.ai/new" }],
      ["artifact:7f3c", { tab: { id: 1 } }],
      ["artifact:7f3c", POPUP_IN_TAB],
    ] as const) {
      expect(await handle({ type: "rescue:openAs", accountId: "acct-b", resourceKey }, sender)).toEqual({
        ok: false,
        error: "Nothing to open on this tab",
      });
    }
    await deps.switcher.idle();
    expect((await h.store.load()).resourceMap).toEqual({});
    expect((await h.store.load()).activeId).toBe("acct-a");
  });

  it("rescue:openAs still works after the service worker restarted (no tracked miss)", async () => {
    expect(deps.rescue.miss(1)).toBeUndefined();
    expect(await handle({ type: "rescue:openAs", accountId: "acct-b", resourceKey: "artifact:7f3c" }, ARTIFACT_PAGE)).toEqual({ ok: true, data: null });
    await vi.waitFor(async () => expect((await h.store.load()).activeId).toBe("acct-b"));
  });

  it("rescue:openAs cancels a pending add flow first", async () => {
    await handle({ type: "addAccount:start" }, {});
    await handle({ type: "rescue:openAs", accountId: "acct-b", resourceKey: "artifact:7f3c" }, ARTIFACT_PAGE);
    await vi.waitFor(async () => expect((await h.store.load()).activeId).toBe("acct-b"));
    await deps.switcher.idle();
    expect(await deps.addFlow.isWaiting()).toBe(false);
    expect(await currentSession(h)).toBe("sk-B");
  });

  it("rescue:probe is refused while the pref is off", async () => {
    await deps.rescue.onApiCompleted(
      { tabId: 1, url: "https://claude.ai/api/organizations/org-a/artifacts/7f3c", statusCode: 404 },
      async () => "https://claude.ai/artifact/7f3c",
    );
    expect(await handle({ type: "rescue:probe", resourceKey: "artifact:7f3c" }, { tab: { id: 1 } })).toMatchObject({ ok: false });
    await h.store.updatePrefs({ rescueProbe: true });
    expect(await handle({ type: "rescue:probe", resourceKey: "artifact:7f3c" }, { tab: { id: 1 } })).toEqual({ ok: true, data: [] });
  });

  it("rescue:probe never sends saved cookies outside claude.ai", async () => {
    await h.store.updatePrefs({ rescueProbe: true });
    vi.spyOn(deps.rescue, "miss").mockReturnValue({
      ref: { kind: "artifact", id: "7f3c", key: "artifact:7f3c" },
      apiUrl: "https://claude.ai.example/api/organizations/org-a/artifacts/7f3c",
      pageUrl: "https://claude.ai/artifact/7f3c",
    });
    expect(await handle({ type: "rescue:probe", resourceKey: "artifact:7f3c" }, { tab: { id: 1 } })).toMatchObject({ ok: false });
    expect(deps.probe).not.toHaveBeenCalled();
  });

  describe("add-flow requests wait for a running switch before touching cookies", () => {
    const cases: [string, () => Promise<void>, Request][] = [
      ["start", async () => undefined, { type: "addAccount:start" }],
      [
        "cancel",
        async () => {
          await handle({ type: "addAccount:start" }, {});
        },
        { type: "addAccount:cancel" },
      ],
      [
        "resolveMismatch",
        async () => {
          await handle({ type: "addAccount:start", targetAccountId: "acct-b" }, {});
          await browserAs(h, "sk-C");
          await deps.addFlow.onCookieChanged({ removed: false, cookie: { name: "sessionKey", domain: ".claude.ai" } });
          expect((await deps.addFlow.state()).phase).toBe("mismatch");
        },
        { type: "addAccount:resolveMismatch", addAsNew: false },
      ],
    ];

    it.each(cases)("%s", async (_name, setUp, req) => {
      await setUp();
      const release = holdIdentityCheck("org-b");
      const switched = deps.switcher.switchTo("acct-b");
      await vi.waitFor(() => expect(h.whoAmI).toHaveBeenCalledWith("org-b"));
      expect(await currentSession(h)).toBe("sk-B"); // restored, not yet verified

      const reply = handle(req, {});
      await flush();
      expect(await currentSession(h)).toBe("sk-B");

      release();
      expect(await switched).toMatchObject({ status: "switched", accountId: "acct-b" });
      expect(await reply).toEqual({ ok: true, data: null });
    });
  });

  it("isRequest ignores pushes and junk", () => {
    expect(isRequest({ type: "getState" })).toBe(true);
    expect(isRequest({ type: "state", state: {} })).toBe(false);
    expect(isRequest(null)).toBe(false);
    expect(isRequest("switch")).toBe(false);
  });

  it("buildUiState reports the add flow and switching target", async () => {
    const s = await buildUiState(deps);
    expect(s.add.phase).toBe("idle");
    expect(s.switchingTo).toBeNull();
  });
});

describe("broadcastPush", () => {
  it("tolerates a closed popup and only messages claude.ai tabs", async () => {
    const h = await createHarness();
    h.fake.addTab("https://claude.ai/new");
    h.fake.addTab("https://example.com/");
    await expect(broadcastPush({ type: "rescue:show", rescue: { resourceKey: "k", kind: "chat", currentAccountId: null, candidates: [], rememberedAccountId: null } })).resolves.toBeUndefined();
    expect(h.fake.sentToTabs.map((m) => m.tabId)).toEqual([1]);
  });
});
