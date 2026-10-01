import { vi } from "vitest";
import { AccountStore } from "../../src/background/accounts";
import { AuthError } from "../../src/background/claudeApi";
import * as jar from "../../src/background/cookieJar";
import { reloadClaudeTabs, type SwitchDeps } from "../../src/background/switcher";
import type { Identity, StoredCookie } from "../../src/shared/types";
import { installChromeFake, seedCookie, type ChromeFake } from "../fakes/chrome";

export const IDENTITIES: Record<"A" | "B" | "C", Identity> = {
  A: { accountUuid: "acct-a", email: "a@acme.example", name: "Ana", orgUuid: "org-a", orgName: "A org", plan: "Max 20x" },
  B: { accountUuid: "acct-b", email: "b@personal.example", name: "Bea", orgUuid: "org-b", orgName: "B org", plan: "Pro" },
  C: { accountUuid: "acct-c", email: "c@lab.example", name: "Cai", orgUuid: "org-c", orgName: "C org", plan: "Team" },
};

/** Session values look like "sk-A", "sk-A-rotated"; anything else (e.g. "sk-dead") is revoked. */
export function identityForSession(value: string | undefined): Identity | undefined {
  const m = /^sk-([ABC])(?:-|$)/.exec(value ?? "");
  return m ? IDENTITIES[m[1] as "A" | "B" | "C"] : undefined;
}

export function sessionCookie(value: string, extra: Partial<StoredCookie> = {}): StoredCookie {
  return {
    name: "sessionKey", value, domain: ".claude.ai", path: "/", secure: true, httpOnly: true, sameSite: "lax", hostOnly: false,
    expirationDate: Date.now() / 1000 + 86_400, ...extra,
  };
}

export function orgCookie(org: string): StoredCookie {
  return {
    name: "lastActiveOrg", value: org, domain: ".claude.ai", path: "/", secure: true, httpOnly: false, sameSite: "lax", hostOnly: false,
    expirationDate: Date.now() / 1000 + 86_400,
  };
}

export interface Harness {
  fake: ChromeFake;
  store: AccountStore;
  deps: SwitchDeps;
  whoAmI: ReturnType<typeof vi.fn<(org?: string | null) => Promise<Identity>>>;
  now: { value: number };
}

export async function createHarness(): Promise<Harness> {
  const fake = installChromeFake();
  const store = new AccountStore(fake.chrome.storage.local);
  const now = { value: Date.now() };
  const whoAmI = vi.fn(async (_org?: string | null): Promise<Identity> => {
    const [c] = await fake.api.cookies.getAll({ name: "sessionKey" });
    const identity = identityForSession(c?.value);
    if (!identity) throw new AuthError(401);
    return identity;
  });
  const deps: SwitchDeps = { jar, store, api: { whoAmI }, tabs: { reloadClaudeTabs }, now: () => now.value };
  await seedCookie(fake, { name: "cf_clearance", value: "cf-1", domain: ".claude.ai", httpOnly: true });
  return { fake, store, deps, whoAmI, now };
}

/** Saves account `letter` with a session cookie (as if added earlier). Does not touch the browser. */
export async function saveAccount(h: Harness, letter: "A" | "B" | "C", value = `sk-${letter}`): Promise<void> {
  const identity = IDENTITIES[letter];
  await h.store.upsert(identity, [sessionCookie(value), orgCookie(identity.orgUuid)], h.now.value);
}

/** Puts a session cookie in the browser, as claude.ai's login would. */
export async function browserAs(h: Harness, value: string): Promise<void> {
  await seedCookie(h.fake, { name: "sessionKey", value, domain: ".claude.ai", httpOnly: true, expirationDate: Date.now() / 1000 + 86_400 });
}

export async function currentSession(h: Harness): Promise<string | undefined> {
  return (await h.fake.api.cookies.getAll({ name: "sessionKey" }))[0]?.value;
}
