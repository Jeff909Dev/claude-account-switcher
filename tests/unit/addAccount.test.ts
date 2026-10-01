import { beforeEach, describe, expect, it } from "vitest";
import { NetworkError } from "../../src/background/claudeApi";
import { seedCookie } from "../fakes/chrome";
import { ADD_FLOW_TIMEOUT_MS, AddAccountFlow, type AddDeps } from "../../src/background/addAccount";
import type { AddFlowPublic } from "../../src/shared/types";
import { browserAs, createHarness, currentSession, saveAccount, sessionCookie, type Harness } from "./harness";

describe("AddAccountFlow", () => {
  let h: Harness;
  let deps: AddDeps;
  let flow: AddAccountFlow;
  let changes: AddFlowPublic[];

  beforeEach(async () => {
    h = await createHarness();
    await saveAccount(h, "A");
    await browserAs(h, "sk-A-live");
    await h.store.setActive("acct-a");
    h.fake.addTab("https://claude.ai/new"); // tab 1
    deps = {
      ...h.deps,
      session: h.fake.chrome.storage.session,
      openLoginTab: async (url) => h.fake.addTab(url, 1, true).id,
      closeTab: (id) => h.fake.api.tabs.remove(id),
    };
    changes = [];
    flow = new AddAccountFlow(deps, (s) => changes.push(s));
  });

  const signInAs = async (value: string, f: AddAccountFlow = flow) => {
    await browserAs(h, value);
    await f.onCookieChanged({ removed: false, cookie: { name: "sessionKey", domain: ".claude.ai" } });
  };

  it("start saves the current login, clears auth cookies and opens claude.ai login", async () => {
    await flow.start();
    expect((await h.store.get("acct-a"))!.cookies.find((c) => c.name === "sessionKey")!.value).toBe("sk-A-live");
    expect(await currentSession(h)).toBeUndefined();
    expect((await h.fake.api.cookies.getAll({ name: "cf_clearance" })).length).toBe(1);
    expect([...h.fake.tabMap.values()].some((t) => t.url === "https://claude.ai/login")).toBe(true);
    expect((await flow.state()).phase).toBe("waitingLogin");
  });

  it("saves a new account when claude.ai sets a session, reloading other claude.ai tabs only", async () => {
    await flow.start(); // login tab = 2
    await signInAs("sk-B");
    const s = await flow.state();
    expect(s).toMatchObject({ phase: "saved", savedAccountId: "acct-b", isNew: true });
    expect((await h.store.load()).activeId).toBe("acct-b");
    expect(h.fake.reloads).toEqual([1]);
  });

  it("saves the new login with the org claude.ai has selected for it (lastActiveOrg)", async () => {
    await flow.start();
    await seedCookie(h.fake, { name: "lastActiveOrg", value: "org-team", domain: ".claude.ai" });
    await signInAs("sk-B");
    expect(h.whoAmI).toHaveBeenLastCalledWith("org-team");
    expect((await flow.state()).phase).toBe("saved");
  });

  it("re-adding an account that is already saved updates it", async () => {
    await flow.start();
    await signInAs("sk-A-again");
    expect(await flow.state()).toMatchObject({ phase: "saved", savedAccountId: "acct-a", isNew: false });
    const s = await h.store.load();
    expect(s.order).toEqual(["acct-a"]);
    expect(s.accounts["acct-a"]!.cookies.find((c) => c.name === "sessionKey")!.value).toBe("sk-A-again");
  });

  it("cancel restores the previous login, closes the login tab and reloads", async () => {
    await flow.start();
    await flow.cancel();
    expect(await currentSession(h)).toBe("sk-A-live");
    expect((await h.store.load()).activeId).toBe("acct-a");
    expect(h.fake.removedTabs).toEqual([2]);
    expect(h.fake.reloads).toEqual([1]);
    expect((await flow.state()).phase).toBe("idle");
  });

  it("times out after 15 minutes back to the previous account (magic link opened elsewhere)", async () => {
    await flow.start();
    h.now.value += ADD_FLOW_TIMEOUT_MS + 1;
    expect((await flow.state()).phase).toBe("idle");
    expect(await currentSession(h)).toBe("sk-A-live");
  });

  it("closing the login tab keeps waiting; the magic link can finish in another tab", async () => {
    await flow.start();
    await h.fake.api.tabs.remove(2);
    expect((await flow.state()).phase).toBe("waitingLogin");
    h.fake.addTab("https://claude.ai/magic-link?token=x");
    await signInAs("sk-B");
    expect((await flow.state()).phase).toBe("saved");
  });

  it("survives a service-worker restart (state lives in storage.session)", async () => {
    await flow.start();
    const restarted = new AddAccountFlow(deps);
    await signInAs("sk-B", restarted);
    expect(await restarted.state()).toMatchObject({ phase: "saved", savedAccountId: "acct-b" });
  });

  it("completes on state() when the cookie event was missed", async () => {
    await flow.start();
    await browserAs(h, "sk-B");
    expect((await flow.state()).phase).toBe("saved");
  });

  it("ignores removals, other cookies and not-yet-valid sessions", async () => {
    await flow.start();
    await flow.onCookieChanged({ removed: true, cookie: { name: "sessionKey", domain: ".claude.ai" } });
    await flow.onCookieChanged({ removed: false, cookie: { name: "lastActiveOrg", domain: ".claude.ai" } });
    await flow.onCookieChanged({ removed: false, cookie: { name: "sessionKey", domain: ".example.com" } });
    await signInAs("sk-dead");
    expect((await flow.state()).phase).toBe("waitingLogin");
  });

  it("handles a burst of cookie events with a single save", async () => {
    await flow.start();
    await browserAs(h, "sk-B");
    const ev = { removed: false, cookie: { name: "sessionKey", domain: ".claude.ai" } };
    await Promise.all([flow.onCookieChanged(ev), flow.onCookieChanged(ev), flow.onCookieChanged(ev)]);
    expect(changes.filter((c) => c.phase === "saved")).toHaveLength(1);
  });

  describe("sign in again (targeted)", () => {
    beforeEach(async () => {
      await saveAccount(h, "B");
      await browserAs(h, "sk-B-live");
      await h.store.setActive("acct-b");
      await h.store.setCookies("acct-a", [sessionCookie("sk-dead")], h.now.value);
      await h.store.setStatus("acct-a", "signedOut");
    });

    it("replaces the cookies when the right account signs in", async () => {
      await flow.start("acct-a");
      await signInAs("sk-A-new");
      expect(await flow.state()).toMatchObject({ phase: "saved", savedAccountId: "acct-a", isNew: false });
      expect(await h.store.get("acct-a")).toMatchObject({ status: "ok" });
    });

    it("asks before adding a different account; cancel restores the previous one", async () => {
      await flow.start("acct-a");
      await signInAs("sk-C");
      expect(await flow.state()).toMatchObject({ phase: "mismatch", mismatchEmail: "c@lab.example", targetAccountId: "acct-a" });
      await flow.resolveMismatch(false);
      expect(await currentSession(h)).toBe("sk-B-live");
      expect((await h.store.load()).order).not.toContain("acct-c");
      expect((await flow.state()).phase).toBe("idle");
    });

    it("adds the different account when asked to", async () => {
      await flow.start("acct-a");
      await signInAs("sk-C");
      await flow.resolveMismatch(true);
      expect(await flow.state()).toMatchObject({ phase: "saved", savedAccountId: "acct-c", isNew: true });
      expect((await h.store.load()).activeId).toBe("acct-c");
    });
  });

  it("start from a signed-out browser remembers no previous account", async () => {
    await h.fake.api.cookies.remove({ url: "https://claude.ai/", name: "sessionKey" });
    await flow.start();
    await flow.cancel();
    expect((await h.store.load()).activeId).toBeNull();
  });

  it("dismiss returns to idle after saved", async () => {
    await flow.start();
    await signInAs("sk-B");
    await flow.dismiss();
    expect((await flow.state()).phase).toBe("idle");
  });
  it("start surfaces an error and leaves the browser untouched when the current login cannot be verified", async () => {
    h.whoAmI.mockRejectedValueOnce(new NetworkError("offline"));
    await flow.start();
    expect(await flow.state()).toMatchObject({ phase: "error" });
    expect((await flow.state()).message).not.toBeNull();
    expect(await currentSession(h)).toBe("sk-A-live");
    expect(h.fake.tabMap.size).toBe(1);
    expect((await h.store.load()).activeId).toBe("acct-a");
  });

  describe("mismatch", () => {
    beforeEach(async () => {
      await saveAccount(h, "B");
      await h.store.setStatus("acct-b", "signedOut");
      await flow.start("acct-b"); // login tab = 2
      await signInAs("sk-C");
    });

    it("mismatch counts as waiting", async () => {
      expect((await flow.state()).phase).toBe("mismatch");
      expect(await flow.isWaiting()).toBe(true);
    });

    it("closes the login tab when cancelled", async () => {
      await flow.resolveMismatch(false);
      expect(h.fake.removedTabs).toEqual([2]);
    });

    it("excludes the login tab from reloads when added as new", async () => {
      await flow.resolveMismatch(true);
      expect(h.fake.reloads).toEqual([1]);
    });
  });
  it("a live verifiable login wins over the timeout when the cookie event was missed", async () => {
    await flow.start();
    await browserAs(h, "sk-B");
    h.now.value += ADD_FLOW_TIMEOUT_MS + 1;
    expect(await flow.state()).toMatchObject({ phase: "saved", savedAccountId: "acct-b" });
    expect(await currentSession(h)).toBe("sk-B");
  });

  describe("signed in, but claude.ai's identity check keeps failing", () => {
    let real: NonNullable<ReturnType<Harness["whoAmI"]["getMockImplementation"]>>;
    beforeEach(async () => {
      await flow.start(); // login tab = 2
      real = h.whoAmI.getMockImplementation()!;
      h.whoAmI.mockRejectedValue(new NetworkError("offline"));
      await signInAs("sk-B");
    });

    it("keeps waiting and says why, naming the account Cancel goes back to", async () => {
      const s = await flow.state();
      expect(s.phase).toBe("waitingLogin");
      expect(s.message).toContain("identity check failed");
      expect(s.message).toContain("Cancel to go back to Acme");
      expect(s.message).not.toMatch(/sk-|offline/);
    });

    it("is never wiped by the timeout: a live login waits for an explicit Cancel", async () => {
      h.now.value += ADD_FLOW_TIMEOUT_MS + 1;
      expect((await flow.state()).phase).toBe("waitingLogin");
      expect(await currentSession(h)).toBe("sk-B");
      expect(h.fake.removedTabs).toEqual([]);
      await flow.cancel();
      expect(await currentSession(h)).toBe("sk-A-live");
    });

    it("finishes once the identity check answers", async () => {
      h.whoAmI.mockImplementation(real);
      expect(await flow.state()).toMatchObject({ phase: "saved", savedAccountId: "acct-b", message: null });
    });

    it("drops the message and times out again once the login is gone", async () => {
      await h.fake.api.cookies.remove({ url: "https://claude.ai/", name: "sessionKey" });
      expect(await flow.state()).toMatchObject({ phase: "waitingLogin", message: null });
      h.now.value += ADD_FLOW_TIMEOUT_MS + 1;
      expect((await flow.state()).phase).toBe("idle");
      expect(await currentSession(h)).toBe("sk-A-live");
    });

    it("tells the listener once, not on every check", async () => {
      await flow.state();
      await flow.state();
      expect(changes.filter((c) => c.phase === "waitingLogin" && c.message !== null)).toHaveLength(1);
    });
  });

  it("a timeout closes the login tab", async () => {
    await flow.start();
    h.now.value += ADD_FLOW_TIMEOUT_MS + 1;
    await flow.state();
    expect(h.fake.removedTabs).toEqual([2]);
  });

  it("a throwing onChange listener does not break start", async () => {
    const throwing = new AddAccountFlow(deps, () => {
      throw new Error("listener");
    });
    await throwing.start();
    expect(await currentSession(h)).toBeUndefined();
    expect([...h.fake.tabMap.values()].some((t) => t.url === "https://claude.ai/login")).toBe(true);
  });

  it("start while waiting is a no-op that keeps the previous login", async () => {
    await flow.start();
    await flow.start();
    await flow.cancel();
    expect(await currentSession(h)).toBe("sk-A-live");
    expect(h.fake.tabMap.size).toBe(1);
  });

  it("start while in mismatch is a no-op", async () => {
    await flow.start("acct-b");
    await signInAs("sk-C");
    await flow.start();
    expect((await flow.state()).phase).toBe("mismatch");
  });
});
