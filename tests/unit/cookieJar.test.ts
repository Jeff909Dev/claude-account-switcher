import { beforeEach, describe, expect, it } from "vitest";
import { clear, cookieHeader, cookieUrl, hasLiveSession, restore, snapshot } from "../../src/background/cookieJar";
import type { StoredCookie } from "../../src/shared/types";
import { installChromeFake, seedCookie, type ChromeFake } from "../fakes/chrome";

const future = () => Date.now() / 1000 + 3600;

describe("cookieJar", () => {
  let fake: ChromeFake;
  beforeEach(async () => {
    fake = installChromeFake();
    await seedCookie(fake, { name: "sessionKey", value: "sk-A", domain: ".claude.ai", httpOnly: true, expirationDate: future() });
    await seedCookie(fake, { name: "lastActiveOrg", value: "org-a", domain: ".claude.ai" });
    await seedCookie(fake, { name: "hostcookie", value: "h" }); // host-only
    for (const name of ["__cf_bm", "cf_clearance", "_cfuvid"]) await seedCookie(fake, { name, value: `cf-${name}`, domain: ".claude.ai" });
    await seedCookie(fake, { name: "other", value: "x", domain: ".example.com" });
  });

  it("snapshots every claude.ai cookie except Cloudflare's", async () => {
    const names = (await snapshot()).map((c) => c.name).sort();
    expect(names).toEqual(["hostcookie", "lastActiveOrg", "sessionKey"]);
  });

  it("clears everything but the Cloudflare cookies and other sites", async () => {
    expect(await clear()).toBe(3);
    const left = (await fake.api.cookies.getAll({})).map((c) => c.name).sort();
    expect(left).toEqual(["__cf_bm", "_cfuvid", "cf_clearance", "other"]);
  });

  it("round-trips snapshot → clear → restore, keeping host-only vs domain cookies", async () => {
    const saved = await snapshot();
    await clear();
    expect(await restore(saved)).toBe(3);
    const again = await snapshot();
    expect(again.sort((a, b) => a.name.localeCompare(b.name))).toEqual(saved.sort((a, b) => a.name.localeCompare(b.name)));
    expect(again.find((c) => c.name === "hostcookie")).toMatchObject({ hostOnly: true, domain: "claude.ai" });
    expect(again.find((c) => c.name === "sessionKey")).toMatchObject({ hostOnly: false, domain: ".claude.ai", httpOnly: true });
  });

  it("skips expired and Cloudflare cookies on restore", async () => {
    await clear();
    const saved: StoredCookie[] = [
      { name: "sessionKey", value: "old", domain: ".claude.ai", path: "/", secure: true, httpOnly: true, sameSite: "lax", hostOnly: false, expirationDate: Date.now() / 1000 - 5 },
      { name: "cf_clearance", value: "stale", domain: ".claude.ai", path: "/", secure: true, httpOnly: true, sameSite: "lax", hostOnly: false },
    ];
    expect(await restore(saved)).toBe(0);
    expect(hasLiveSession(saved, Date.now())).toBe(false);
    expect((await fake.api.cookies.getAll({ name: "cf_clearance" }))[0]!.value).toBe("cf-cf_clearance");
  });

  it("builds urls and Cookie headers", () => {
    expect(cookieUrl({ domain: ".claude.ai", path: "/", secure: true })).toBe("https://claude.ai/");
    expect(cookieUrl({ domain: "localhost", path: "/api", secure: false })).toBe("http://localhost/api");
    const c = (name: string, value: string, exp?: number): StoredCookie => ({
      name, value, domain: ".claude.ai", path: "/", secure: true, httpOnly: false, sameSite: "lax", hostOnly: false,
      ...(exp !== undefined ? { expirationDate: exp } : {}),
    });
    expect(cookieHeader([c("a", "1"), c("b", "2", future()), c("x", "dead", 1)])).toBe("a=1; b=2");
  });
});
