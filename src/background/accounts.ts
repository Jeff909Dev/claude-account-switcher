import type { Account, AccountStatus, Identity, Prefs, PublicAccount, StoreState, StoredCookie } from "../shared/types";
import { ACCOUNT_COLORS } from "../shared/types";
import { createSerialQueue } from "./serial";

export const STORE_KEY = "cas:state";
/** How many "Open as" choices are remembered; the oldest go first. */
export const RESOURCE_MAP_LIMIT = 500;
export const DEFAULT_PREFS: Prefs = { theme: "system", style: "app", inPageSwitcher: true, badge: true };
const PUBLIC_MAIL = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "icloud.com", "me.com", "yahoo.com", "proton.me", "protonmail.com",
]);

export class UnsupportedStoreVersion extends Error {}

export function emptyState(): StoreState {
  return { version: 1, accounts: {}, order: [], activeId: null, resourceMap: {}, prefs: { ...DEFAULT_PREFS } };
}

export function migrate(raw: unknown): StoreState {
  if (raw === undefined || raw === null) return emptyState();
  const r = raw as Partial<StoreState> & { version?: unknown };
  if (r.version !== 1) throw new UnsupportedStoreVersion(`Unsupported store version ${String(r.version)}`);
  return { ...emptyState(), ...r, prefs: sanitizePrefs({ ...DEFAULT_PREFS, ...(r.prefs ?? {}) }) } as StoreState;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function defaultLabel(identity: Pick<Identity, "email">): string {
  const [local = "", domain = ""] = identity.email.toLowerCase().split("@");
  const base = !domain || PUBLIC_MAIL.has(domain) ? local : (domain.split(".")[0] ?? local);
  return capitalize(base);
}

export function pickLabel(identity: Pick<Identity, "email">, taken: Set<string>): string {
  const first = defaultLabel(identity);
  if (!taken.has(first)) return first;
  const second = capitalize((identity.email.split("@")[0] ?? "").toLowerCase());
  if (second && !taken.has(second)) return second;
  let n = 2;
  while (taken.has(`${first} ${n}`)) n++;
  return `${first} ${n}`;
}

export function orderedAccounts(state: StoreState): Account[] {
  return state.order.map((id) => state.accounts[id]).filter((a): a is Account => a !== undefined);
}

export function toPublic(a: Account): PublicAccount {
  const { cookies: _cookies, ...rest } = a;
  return rest;
}

function sanitizePrefs(p: Prefs): Prefs {
  return {
    theme: p.theme === "dark" || p.theme === "light" ? p.theme : "system",
    style: p.style === "cli" ? "cli" : "app",
    inPageSwitcher: Boolean(p.inPageSwitcher),
    badge: Boolean(p.badge),
  };
}

function firstFreeColor(used: Set<number>): number {
  for (let i = 0; i < ACCOUNT_COLORS.length; i++) if (!used.has(i)) return i;
  return used.size % ACCOUNT_COLORS.length;
}

export class AccountStore {
  private readonly serial = createSerialQueue();

  constructor(private readonly area: chrome.storage.StorageArea = chrome.storage.local) {}

  async load(): Promise<StoreState> {
    const got = await this.area.get(STORE_KEY);
    return migrate(got[STORE_KEY]);
  }

  /** Read-modify-write, serialized so concurrent callers never lose each other's writes. */
  update(fn: (s: StoreState) => void): Promise<StoreState> {
    return this.serial(async () => {
      const s = await this.load();
      fn(s);
      await this.area.set({ [STORE_KEY]: s });
      return s;
    });
  }

  async list(): Promise<Account[]> {
    return orderedAccounts(await this.load());
  }

  async get(id: string): Promise<Account | undefined> {
    return (await this.load()).accounts[id];
  }

  async upsert(identity: Identity, cookies: StoredCookie[], now: number): Promise<{ account: Account; isNew: boolean }> {
    let out: { account: Account; isNew: boolean } | undefined;
    await this.update((s) => {
      const prev = s.accounts[identity.accountUuid];
      const others = Object.values(s.accounts).filter((a) => a.id !== identity.accountUuid);
      const account: Account = {
        id: identity.accountUuid,
        email: identity.email,
        name: identity.name,
        label: prev?.label ?? pickLabel(identity, new Set(others.map((a) => a.label))),
        color: prev?.color ?? firstFreeColor(new Set(others.map((a) => a.color))),
        plan: identity.plan,
        orgUuid: identity.orgUuid,
        cookies,
        savedAt: now,
        status: "ok",
      };
      s.accounts[account.id] = account;
      if (!s.order.includes(account.id)) s.order.push(account.id);
      out = { account, isNew: !prev };
    });
    return out!;
  }

  async setCookies(id: string, cookies: StoredCookie[], now: number): Promise<void> {
    await this.update((s) => {
      const a = s.accounts[id];
      if (!a) return;
      a.cookies = cookies;
      a.savedAt = now;
      a.status = "ok";
    });
  }

  async setActive(id: string | null): Promise<void> {
    await this.update((s) => {
      s.activeId = id !== null && s.accounts[id] ? id : null;
    });
  }

  async setStatus(id: string, status: AccountStatus): Promise<void> {
    await this.update((s) => {
      const a = s.accounts[id];
      if (a) a.status = status;
    });
  }

  async rename(id: string, label: string): Promise<void> {
    await this.update((s) => {
      const a = s.accounts[id];
      if (!a) return;
      const trimmed = label.trim().slice(0, 32);
      a.label = trimmed || defaultLabel(a);
    });
  }

  async setColor(id: string, color: number): Promise<void> {
    await this.update((s) => {
      const a = s.accounts[id];
      if (!a) return;
      const n = ACCOUNT_COLORS.length;
      a.color = ((Math.trunc(color) % n) + n) % n;
    });
  }

  async remove(id: string): Promise<void> {
    await this.update((s) => {
      delete s.accounts[id];
      s.order = s.order.filter((x) => x !== id);
      if (s.activeId === id) s.activeId = null;
      for (const [key, r] of Object.entries(s.resourceMap)) if (r.accountId === id) delete s.resourceMap[key];
    });
  }

  async reorder(order: string[]): Promise<void> {
    await this.update((s) => {
      const known = order.filter((id, i) => s.accounts[id] !== undefined && order.indexOf(id) === i);
      s.order = [...known, ...s.order.filter((id) => !known.includes(id))];
    });
  }

  async rememberResource(resourceKey: string, accountId: string, now: number = Date.now()): Promise<void> {
    await this.update((s) => {
      if (!s.accounts[accountId]) return;
      s.resourceMap[resourceKey] = { accountId, at: now };
      // Recency is a timestamp, not key order: chrome.storage doesn't keep an object's key order.
      const entries = Object.entries(s.resourceMap);
      if (entries.length <= RESOURCE_MAP_LIMIT) return;
      entries.sort(([, a], [, b]) => b.at - a.at);
      for (const [key] of entries.slice(RESOURCE_MAP_LIMIT)) delete s.resourceMap[key];
    });
  }

  async resourceAccount(resourceKey: string): Promise<string | undefined> {
    return (await this.load()).resourceMap[resourceKey]?.accountId;
  }

  async updatePrefs(patch: Partial<Prefs>): Promise<void> {
    await this.update((s) => {
      s.prefs = sanitizePrefs({ ...s.prefs, ...patch });
    });
  }
}
