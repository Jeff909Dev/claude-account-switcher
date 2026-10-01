import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthError, NetworkError } from "../../src/background/claudeApi";
import { Switcher, reloadClaudeTabs, saveCurrentSession } from "../../src/background/switcher";
import { seedCookie } from "../fakes/chrome";
import { browserAs, createHarness, currentSession, saveAccount, sessionCookie, type Harness } from "./harness";

const sessionOf = async (h: Harness, id: string) =>
  (await h.store.get(id))!.cookies.find((c) => c.name === "sessionKey")!.value;

describe("Switcher", () => {
  let h: Harness;
  let switcher: Switcher;
  beforeEach(async () => {
    h = await createHarness();
    await saveAccount(h, "A");
    await saveAccount(h, "B");
    await browserAs(h, "sk-A-live"); // claude.ai rotated A's cookie since it was saved
    await h.store.setActive("acct-a");
    h.fake.addTab("https://claude.ai/new", 1); // tab 1
    h.fake.addTab("https://claude.ai/chat/x", 2); // tab 2, another window
    h.fake.addTab("https://example.com/", 1); // tab 3
    switcher = new Switcher(h.deps);
  });

  it("swaps cookies, saves the outgoing session and reloads claude.ai tabs in every window", async () => {
    const r = await switcher.switchTo("acct-b");
    expect(r).toEqual({ status: "switched", accountId: "acct-b", reloadedTabs: 2 });
    expect(await currentSession(h)).toBe("sk-B");
    expect((await h.store.load()).activeId).toBe("acct-b");
    expect(await sessionOf(h, "acct-a")).toBe("sk-A-live");
    expect([...h.fake.reloads].sort()).toEqual([1, 2]);
    expect((await h.fake.api.cookies.getAll({ name: "cf_clearance" })).map((c) => c.value)).toEqual(["cf-1"]);
  });

  it("reports signedOut and rolls back when the saved session has expired", async () => {
    await h.store.setCookies("acct-b", [sessionCookie("sk-B", { expirationDate: Date.now() / 1000 - 60 })], h.now.value);
    const r = await switcher.switchTo("acct-b");
    expect(r).toEqual({ status: "signedOut", accountId: "acct-b" });
    expect(await currentSession(h)).toBe("sk-A-live");
    const s = await h.store.load();
    expect(s.activeId).toBe("acct-a");
    expect(s.accounts["acct-b"]!.status).toBe("signedOut");
    expect(h.fake.reloads).toEqual([]);
  });

  it("reports signedOut when claude.ai rejects (revoked) the saved session", async () => {
    await h.store.setCookies("acct-b", [sessionCookie("sk-dead")], h.now.value);
    expect((await switcher.switchTo("acct-b")).status).toBe("signedOut");
    expect(await currentSession(h)).toBe("sk-A-live");
    expect((await h.store.get("acct-b"))!.status).toBe("signedOut");
  });

  it("refuses a saved session that belongs to someone else", async () => {
    await h.store.setCookies("acct-b", [sessionCookie("sk-C")], h.now.value);
    const r = await switcher.switchTo("acct-b");
    expect(r.status).toBe("error");
    expect(await currentSession(h)).toBe("sk-A-live");
    expect((await h.store.load()).activeId).toBe("acct-a");
  });

  it("rolls back to the previous account when restoring the target throws mid-way", async () => {
    const realSet = h.fake.api.cookies.set;
    let failed = false;
    h.fake.api.cookies.set = vi.fn(async (details: Parameters<typeof realSet>[0]) => {
      if (!failed && details.name === "lastActiveOrg") {
        failed = true; // sessionKey of B is already restored, the next cookie fails
        throw new Error("Failed to set cookie");
      }
      return realSet(details);
    }) as typeof realSet;
    const r = await switcher.switchTo("acct-b");
    expect(r).toEqual({ status: "error", accountId: "acct-b", message: "Failed to set cookie" });
    expect(failed).toBe(true);
    expect(await currentSession(h)).toBe("sk-A-live");
    expect((await h.store.load()).activeId).toBe("acct-a");
    expect(h.fake.reloads).toEqual([]);
  });

  describe("hardening", () => {
    const withJar = (over: Partial<Harness["deps"]["jar"]>) => ({ ...h.deps, jar: { ...h.deps.jar, ...over } });
    const restoreFailingFrom = (n: number) => {
      let calls = 0;
      return vi.fn(async (...a: Parameters<Harness["deps"]["jar"]["restore"]>) => {
        if (++calls >= n) throw new Error("restore boom");
        return h.deps.jar.restore(...a);
      });
    };

    it.each([
      ["a network failure", () => new NetworkError("offline")],
      ["a 403", () => new AuthError(403)],
    ])("leaves the browser untouched when the outgoing identity check hits %s", async (_n, mkErr) => {
      const before = h.fake.cookieSets.length;
      h.whoAmI.mockRejectedValueOnce(mkErr());
      const r = await switcher.switchTo("acct-b");
      expect(r.status).toBe("error");
      expect(await currentSession(h)).toBe("sk-A-live");
      expect(h.fake.cookieSets.length).toBe(before);
      expect(h.fake.reloads).toEqual([]);
      expect((await h.store.load()).activeId).toBe("acct-a");
    });

    it("keeps the queue alive when onChange throws", async () => {
      const sw = new Switcher(h.deps, () => {
        throw new Error("listener boom");
      });
      expect((await sw.switchTo("acct-b")).status).toBe("switched");
      expect((await sw.switchTo("acct-a")).status).toBe("switched");
    });

    it("does not roll back a committed switch when reloading tabs fails", async () => {
      h.fake.api.tabs.query = vi.fn(async () => {
        throw new Error("tabs boom");
      }) as typeof h.fake.api.tabs.query;
      expect(await switcher.switchTo("acct-b")).toEqual({ status: "switched", accountId: "acct-b", reloadedTabs: 0 });
      expect(await currentSession(h)).toBe("sk-B");
      expect((await h.store.load()).activeId).toBe("acct-b");
    });

    it("marks an expired target signedOut without touching the browser", async () => {
      await h.store.setCookies("acct-b", [sessionCookie("sk-B", { expirationDate: Date.now() / 1000 - 60 })], h.now.value);
      const clear = vi.fn(h.deps.jar.clear);
      const restore = vi.fn(h.deps.jar.restore);
      const r = await new Switcher(withJar({ clear, restore })).switchTo("acct-b");
      expect(r).toEqual({ status: "signedOut", accountId: "acct-b" });
      expect(clear).not.toHaveBeenCalled();
      expect(restore).not.toHaveBeenCalled();
      expect((await h.store.get("acct-b"))!.status).toBe("signedOut");
      expect(await currentSession(h)).toBe("sk-A-live");
    });

    it("reports a failed rollback after a mismatch without hiding the original error", async () => {
      await h.store.setCookies("acct-b", [sessionCookie("sk-C")], h.now.value);
      const r = await new Switcher(withJar({ restore: restoreFailingFrom(2) })).switchTo("acct-b");
      expect(r.status).toBe("error");
      expect(r.status === "error" && r.message).toContain("belongs to c@lab.example");
      expect(r.status === "error" && r.message).toContain("(restoring the previous session also failed)");
    });

    it("still marks signedOut when the rollback fails", async () => {
      await h.store.setCookies("acct-b", [sessionCookie("sk-dead")], h.now.value);
      const r = await new Switcher(withJar({ restore: restoreFailingFrom(2) })).switchTo("acct-b");
      expect(r).toEqual({ status: "signedOut", accountId: "acct-b" });
      expect((await h.store.get("acct-b"))!.status).toBe("signedOut");
    });

    it("flags a failed rollback after restore throws", async () => {
      const r = await new Switcher(withJar({ restore: restoreFailingFrom(1) })).switchTo("acct-b");
      expect(r.status === "error" && r.message).toBe("restore boom (restoring the previous session also failed)");
    });

    it("rolls back on a non-auth failure checking the target and leaves its status alone", async () => {
      const before = await h.store.get("acct-b");
      h.whoAmI.mockImplementationOnce(h.whoAmI.getMockImplementation()!);
      h.whoAmI.mockRejectedValueOnce(new NetworkError("offline"));
      const r = await switcher.switchTo("acct-b");
      expect(r.status).toBe("error");
      expect(await currentSession(h)).toBe("sk-A-live");
      expect((await h.store.get("acct-b"))!.status).toBe(before!.status);
    });

    it("leaves the mismatched target's status and cookies untouched", async () => {
      await h.store.setCookies("acct-b", [sessionCookie("sk-C")], h.now.value);
      const before = await h.store.get("acct-b");
      await switcher.switchTo("acct-b");
      const after = await h.store.get("acct-b");
      expect(after!.status).toBe(before!.status);
      expect(after!.cookies).toEqual(before!.cookies);
    });
  });

  it("never saves one account's cookies under another account", async () => {
    await browserAs(h, "sk-B-manual"); // Jeff signed into B by hand; the store still says A
    expect((await switcher.switchTo("acct-a")).status).toBe("switched");
    expect(await sessionOf(h, "acct-a")).toBe("sk-A");
    expect(await sessionOf(h, "acct-b")).toBe("sk-B-manual");
    expect(await currentSession(h)).toBe("sk-A");
  });

  it("saves an unknown signed-in account before switching away (never destroys a login)", async () => {
    await browserAs(h, "sk-C");
    await switcher.switchTo("acct-a");
    const s = await h.store.load();
    expect(s.order).toEqual(["acct-a", "acct-b", "acct-c"]);
    expect(await sessionOf(h, "acct-c")).toBe("sk-C");
  });

  it("does nothing when asked for the account already signed in", async () => {
    expect(await switcher.switchTo("acct-a")).toEqual({ status: "switched", accountId: "acct-a", reloadedTabs: 0 });
    expect(h.fake.reloads).toEqual([]);
    expect(await currentSession(h)).toBe("sk-A-live");
  });

  it("keeps reloading the other tabs when one tab vanished mid-switch", async () => {
    const original = h.fake.api.tabs.reload;
    h.fake.api.tabs.reload = vi.fn(async (tabId: number) => {
      if (tabId === 1) throw new Error("No tab with id: 1.");
      return original(tabId);
    });
    expect(await switcher.switchTo("acct-b")).toEqual({ status: "switched", accountId: "acct-b", reloadedTabs: 1 });
    expect(h.fake.reloads).toEqual([2]);
  });

  it("runs the last requested switch and supersedes queued ones", async () => {
    await saveAccount(h, "C");
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const real = h.whoAmI.getMockImplementation()!;
    h.whoAmI.mockImplementationOnce(async (org) => {
      await gate;
      return real(org);
    });
    const first = switcher.switchTo("acct-b");
    const second = switcher.switchTo("acct-c");
    const third = switcher.switchTo("acct-a");
    expect(switcher.switchingTo).toBe("acct-b");
    release();
    expect(await second).toEqual({ status: "superseded", accountId: "acct-c" });
    expect((await first).status).toBe("switched");
    expect((await third).status).toBe("switched");
    await switcher.idle();
    expect(switcher.switchingTo).toBeNull();
    expect((await h.store.load()).activeId).toBe("acct-a");
    expect(h.fake.cookieSets.some((c) => c.value === "sk-C")).toBe(false);
  });

  it("notifies onChange with the target, then null and the result", async () => {
    const onChange = vi.fn();
    await new Switcher(h.deps, onChange).switchTo("acct-b");
    expect(onChange.mock.calls[0]).toEqual(["acct-b"]);
    expect(onChange.mock.calls[1]).toEqual([null, { status: "switched", accountId: "acct-b", reloadedTabs: 2 }]);
  });
});

describe("helpers", () => {
  it("saveCurrentSession does nothing for a signed-out browser", async () => {
    const h = await createHarness();
    expect(await saveCurrentSession(h.deps)).toEqual({ savedTo: null, cookies: [], isNew: false });
    expect(h.whoAmI).not.toHaveBeenCalled();
  });

  it("saveCurrentSession checks the login against the org claude.ai has selected (lastActiveOrg)", async () => {
    const h = await createHarness();
    await browserAs(h, "sk-A");
    expect((await saveCurrentSession(h.deps)).savedTo).toBe("acct-a");
    expect(h.whoAmI).toHaveBeenLastCalledWith(null); // no selection: claude.ai's first chat org
    await seedCookie(h.fake, { name: "lastActiveOrg", value: "org-team", domain: ".claude.ai" });
    await saveCurrentSession(h.deps);
    expect(h.whoAmI).toHaveBeenLastCalledWith("org-team");
  });

  it("reloadClaudeTabs can skip one tab", async () => {
    const h = await createHarness();
    h.fake.addTab("https://claude.ai/login");
    h.fake.addTab("https://claude.ai/new");
    expect(await reloadClaudeTabs(1)).toBe(1);
    expect(h.fake.reloads).toEqual([2]);
  });
});
