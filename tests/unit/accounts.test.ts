import { beforeEach, describe, expect, it } from "vitest";
import {
  AccountStore,
  RESOURCE_MAP_LIMIT,
  STORE_KEY,
  UnsupportedStoreVersion,
  defaultLabel,
  emptyState,
  orderedAccounts,
  pickLabel,
  toPublic,
} from "../../src/background/accounts";
import type { Identity, StoredCookie } from "../../src/shared/types";
import { installChromeFake, type ChromeFake } from "../fakes/chrome";

const id = (n: string, email: string, plan = "Pro"): Identity => ({
  accountUuid: `acct-${n}`, email, name: n, orgUuid: `org-${n}`, orgName: `${n} org`, plan,
});
const cookie = (value: string): StoredCookie => ({
  name: "sessionKey", value, domain: ".claude.ai", path: "/", secure: true, httpOnly: true, sameSite: "lax", hostOnly: false,
});

describe("labels", () => {
  it.each([
    ["jeff@acme.example", "Acme"],
    ["someone.personal@outlook.com", "Someone.personal"],
    ["you@work.example", "Work"],
  ])("%s → %s", (email, label) => expect(defaultLabel({ email })).toBe(label));

  it("avoids duplicate labels", () => {
    expect(pickLabel({ email: "b@example.com" }, new Set(["Example"]))).toBe("B");
    expect(pickLabel({ email: "example@example.com" }, new Set(["Example"]))).toBe("Example 2");
  });
});

describe("AccountStore", () => {
  let fake: ChromeFake;
  let store: AccountStore;
  beforeEach(() => {
    fake = installChromeFake();
    store = new AccountStore(fake.chrome.storage.local);
  });

  it("starts empty with default prefs", async () => {
    const s = await store.load();
    expect(s).toMatchObject({ version: 1, order: [], activeId: null });
    expect(s.prefs).toEqual({ theme: "system", style: "app", inPageSwitcher: true, badge: true });
  });

  it("drops the retired rescueProbe pref from a stored state", async () => {
    const prefs = { theme: "dark", style: "app", inPageSwitcher: false, badge: true, rescueProbe: true };
    await fake.api.storage.local.set({ [STORE_KEY]: { version: 1, accounts: {}, order: [], activeId: null, resourceMap: {}, prefs } });
    expect((await store.load()).prefs).toEqual({ theme: "dark", style: "app", inPageSwitcher: false, badge: true });
  });

  it("adds accounts in order with distinct labels and colours", async () => {
    const a = await store.upsert(id("a", "a@example.com"), [cookie("sk-a")], 1);
    const b = await store.upsert(id("b", "b@example.com"), [cookie("sk-b")], 2);
    expect(a.isNew && b.isNew).toBe(true);
    expect((await store.list()).map((x) => [x.label, x.color])).toEqual([["Example", 0], ["B", 1]]);
  });

  it("re-adding an account updates it instead of duplicating (keeps label and colour)", async () => {
    await store.upsert(id("a", "a@example.com"), [cookie("sk-a")], 1);
    await store.rename("acct-a", "Work");
    const again = await store.upsert(id("a", "a@example.com", "Max 5x"), [cookie("sk-a2")], 5);
    expect(again.isNew).toBe(false);
    const s = await store.load();
    expect(s.order).toEqual(["acct-a"]);
    expect(s.accounts["acct-a"]).toMatchObject({ label: "Work", color: 0, plan: "Max 5x", savedAt: 5, status: "ok" });
    expect(s.accounts["acct-a"]!.cookies[0]!.value).toBe("sk-a2");
  });

  it("remove clears active and remembered resources pointing at it", async () => {
    await store.upsert(id("a", "a@example.com"), [], 1);
    await store.upsert(id("b", "b@example.com"), [], 1);
    await store.setActive("acct-a");
    await store.rememberResource("artifact:x", "acct-a");
    await store.rememberResource("chat:y", "acct-b");
    await store.remove("acct-a");
    const s = await store.load();
    expect(s.activeId).toBeNull();
    expect(s.order).toEqual(["acct-b"]);
    expect(Object.keys(s.resourceMap)).toEqual(["chat:y"]);
    expect(await store.resourceAccount("chat:y")).toBe("acct-b");
  });

  it("remembers only the most recently opened resources", async () => {
    await store.upsert(id("a", "a@example.com"), [], 1);
    for (let i = 0; i < RESOURCE_MAP_LIMIT; i++) await store.rememberResource(`chat:${i}`, "acct-a", 1000 + i);
    await store.rememberResource("chat:0", "acct-a", 5000); // opened again: now the most recent
    await store.rememberResource("chat:new", "acct-a", 5001);
    const s = await store.load();
    expect(RESOURCE_MAP_LIMIT).toBe(500);
    expect(Object.keys(s.resourceMap)).toHaveLength(RESOURCE_MAP_LIMIT);
    expect(await store.resourceAccount("chat:1")).toBeUndefined(); // the oldest goes
    expect(await store.resourceAccount("chat:0")).toBe("acct-a");
    expect(await store.resourceAccount("chat:new")).toBe("acct-a");
  });

  it("reorder ignores unknown ids and keeps missing ones", async () => {
    for (const n of ["a", "b", "c"]) await store.upsert(id(n, `${n}@x.example`), [], 1);
    await store.reorder(["acct-c", "ghost", "acct-a", "acct-c"]);
    expect((await store.load()).order).toEqual(["acct-c", "acct-a", "acct-b"]);
  });

  it("rename trims, caps at 32 chars and falls back to the default label", async () => {
    await store.upsert(id("a", "a@acme.example"), [], 1);
    await store.rename("acct-a", `  ${"x".repeat(40)} `);
    expect((await store.get("acct-a"))!.label).toBe("x".repeat(32));
    await store.rename("acct-a", "   ");
    expect((await store.get("acct-a"))!.label).toBe("Acme");
  });

  it("setActive ignores unknown ids, setStatus/setColor/prefs persist", async () => {
    await store.upsert(id("a", "a@example.com"), [], 1);
    await store.setActive("ghost");
    expect((await store.load()).activeId).toBeNull();
    await store.setStatus("acct-a", "signedOut");
    await store.setColor("acct-a", 13);
    await store.updatePrefs({ style: "cli", badge: false });
    const s = await store.load();
    expect(s.accounts["acct-a"]).toMatchObject({ status: "signedOut", color: 1 });
    expect(s.prefs).toMatchObject({ style: "cli", badge: false, theme: "system" });
  });

  it("serializes concurrent updates", async () => {
    await Promise.all(["a", "b", "c", "d"].map((n) => store.upsert(id(n, `${n}@x.example`), [], 1)));
    expect((await store.load()).order).toHaveLength(4);
  });

  it("refuses an unknown stored version without overwriting it", async () => {
    await fake.api.storage.local.set({ [STORE_KEY]: { version: 99, accounts: {} } });
    await expect(store.upsert(id("a", "a@x.example"), [], 1)).rejects.toBeInstanceOf(UnsupportedStoreVersion);
    expect((await fake.api.storage.local.get(STORE_KEY))[STORE_KEY]).toEqual({ version: 99, accounts: {} });
  });

  it("toPublic strips cookies", async () => {
    const { account } = await store.upsert(id("a", "a@x.example"), [cookie("secret")], 1);
    expect(JSON.stringify(toPublic(account))).not.toContain("secret");
    expect("cookies" in toPublic(account)).toBe(false);
  });
});

describe("orderedAccounts", () => {
  it("keeps order and ignores ids missing from accounts", async () => {
    const fake = installChromeFake();
    const store = new AccountStore(fake.chrome.storage.local);
    await store.upsert(id("a", "a@x.example"), [], 1);
    await store.upsert(id("b", "b@x.example"), [], 1);
    const s = await store.load();
    s.order = ["acct-b", "ghost", "acct-a"];
    expect(orderedAccounts(s).map((a) => a.id)).toEqual(["acct-b", "acct-a"]);
    expect(orderedAccounts(emptyState())).toEqual([]);
  });
});
