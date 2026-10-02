/* In-memory subset of chrome.* used by the extension. Semantics mirror Chrome where tests depend on them. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => unknown;

export class FakeEvent<L extends AnyFn> {
  private readonly listeners = new Set<L>();
  addListener(l: L, ..._filters: unknown[]): void {
    this.listeners.add(l);
  }
  removeListener(l: L): void {
    this.listeners.delete(l);
  }
  hasListener(l: L): boolean {
    return this.listeners.has(l);
  }
  hasListeners(): boolean {
    return this.listeners.size > 0;
  }
  emit(...args: Parameters<L>): unknown[] {
    return [...this.listeners].map((l) => l(...args));
  }
}

export interface FakeCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: string;
  hostOnly: boolean;
  session: boolean;
  expirationDate?: number;
  storeId: string;
}

export interface FakeTab {
  id: number;
  url: string;
  windowId: number;
  active: boolean;
  status: string;
}

const bare = (d: string) => d.replace(/^\./, "");
/** chrome.cookies.getAll({domain}): cookie domain equals or is a subdomain of `domain`. */
const inDomain = (cookieDomain: string, domain: string) => {
  const c = bare(cookieDomain);
  const q = bare(domain);
  return c === q || c.endsWith(`.${q}`);
};
/** Would this cookie be sent to `host`? */
const sentTo = (c: FakeCookie, host: string) =>
  c.hostOnly ? c.domain === host : host === bare(c.domain) || host.endsWith(`.${bare(c.domain)}`);

export function patternToRegExp(pattern: string): RegExp {
  const m = /^(\*|https?):\/\/([^/]+)(\/.*)$/.exec(pattern);
  if (!m) throw new Error(`Bad match pattern: ${pattern}`);
  const [, scheme, host, path] = m;
  const esc = (s: string) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  const schemeRe = scheme === "*" ? "https?" : scheme!;
  const hostRe = host!.includes(":") ? esc(host!) : `${esc(host!)}(?::\\d+)?`;
  const pathRe = esc(path!).replace(/\*/g, ".*");
  return new RegExp(`^${schemeRe}://${hostRe}${pathRe}$`);
}

export function createStorageArea() {
  let data: Record<string, unknown> = {};
  const onChanged = new FakeEvent<(changes: Record<string, { oldValue?: unknown; newValue?: unknown }>) => void>();
  return {
    async get(keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>> {
      const snap = structuredClone(data);
      if (keys === undefined || keys === null) return snap;
      if (typeof keys === "string") return keys in snap ? { [keys]: snap[keys] } : {};
      if (Array.isArray(keys)) return Object.fromEntries(keys.filter((k) => k in snap).map((k) => [k, snap[k]]));
      return Object.fromEntries(Object.entries(keys).map(([k, d]) => [k, k in snap ? snap[k] : d]));
    },
    async set(items: Record<string, unknown>): Promise<void> {
      const changes: Record<string, { oldValue?: unknown; newValue?: unknown }> = {};
      for (const [k, v] of Object.entries(items)) changes[k] = { oldValue: data[k], newValue: structuredClone(v) };
      data = { ...data, ...structuredClone(items) };
      onChanged.emit(changes);
    },
    async remove(keys: string | string[]): Promise<void> {
      for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k];
    },
    async clear(): Promise<void> {
      data = {};
    },
    onChanged,
  };
}

export function createChromeFake() {
  // --- cookies
  const cookieStore = new Map<string, FakeCookie>();
  const cookieSets: FakeCookie[] = [];
  const keyOf = (c: Pick<FakeCookie, "domain" | "path" | "name">) => `${c.domain}|${c.path}|${c.name}`;
  const cookiesOnChanged = new FakeEvent<(info: { removed: boolean; cookie: FakeCookie; cause: string }) => void>();
  const cookies = {
    async getAll(details: { domain?: string; name?: string } = {}): Promise<FakeCookie[]> {
      return [...cookieStore.values()]
        .filter((c) => details.domain === undefined || inDomain(c.domain, details.domain))
        .filter((c) => details.name === undefined || c.name === details.name)
        .map((c) => ({ ...c }));
    },
    async set(d: {
      url: string;
      name?: string;
      value?: string;
      domain?: string;
      path?: string;
      secure?: boolean;
      httpOnly?: boolean;
      sameSite?: string;
      expirationDate?: number;
    }): Promise<FakeCookie | null> {
      const url = new URL(d.url);
      const hostOnly = d.domain === undefined;
      const c: FakeCookie = {
        name: d.name ?? "",
        value: d.value ?? "",
        domain: hostOnly ? url.hostname : `.${bare(d.domain!)}`,
        path: d.path ?? "/",
        secure: d.secure ?? false,
        httpOnly: d.httpOnly ?? false,
        sameSite: d.sameSite ?? "unspecified",
        hostOnly,
        session: d.expirationDate === undefined,
        storeId: "0",
        ...(d.expirationDate !== undefined ? { expirationDate: d.expirationDate } : {}),
      };
      const key = keyOf(c);
      if (c.expirationDate !== undefined && c.expirationDate * 1000 <= Date.now()) {
        const old = cookieStore.get(key);
        if (old && cookieStore.delete(key)) cookiesOnChanged.emit({ removed: true, cookie: { ...old }, cause: "expired_overwrite" });
        return null;
      }
      const old = cookieStore.get(key);
      if (old) cookiesOnChanged.emit({ removed: true, cookie: { ...old }, cause: "overwrite" });
      cookieStore.set(key, c);
      cookieSets.push({ ...c });
      cookiesOnChanged.emit({ removed: false, cookie: { ...c }, cause: "explicit" });
      return { ...c };
    },
    async remove(d: { url: string; name: string; storeId?: string }) {
      const url = new URL(d.url);
      const match = [...cookieStore.values()]
        .filter((c) => c.name === d.name && sentTo(c, url.hostname) && url.pathname.startsWith(c.path))
        .sort((a, b) => b.path.length - a.path.length)[0];
      if (!match) return null;
      cookieStore.delete(keyOf(match));
      cookiesOnChanged.emit({ removed: true, cookie: { ...match }, cause: "explicit" });
      return { url: d.url, name: d.name, storeId: "0" };
    },
    onChanged: cookiesOnChanged,
  };

  // --- tabs
  const tabMap = new Map<number, FakeTab>();
  let nextTabId = 1;
  const reloads: number[] = [];
  const removedTabs: number[] = [];
  const sentToTabs: { tabId: number; message: unknown }[] = [];
  const onRemoved = new FakeEvent<(tabId: number, info: { windowId: number; isWindowClosing: boolean }) => void>();
  const onUpdated = new FakeEvent<(tabId: number, change: { status?: string; url?: string }, tab: FakeTab) => void>();
  function addTab(url: string, windowId = 1, active = false): FakeTab {
    const t: FakeTab = { id: nextTabId++, url, windowId, active, status: "complete" };
    tabMap.set(t.id, t);
    return t;
  }
  function navigate(tabId: number, url: string): void {
    const t = tabMap.get(tabId);
    if (!t) throw new Error(`No tab with id: ${tabId}.`);
    t.url = url;
    onUpdated.emit(tabId, { status: "loading", url }, { ...t });
  }
  const tabs = {
    async query(q: { url?: string | string[] } = {}): Promise<FakeTab[]> {
      const pats = q.url === undefined ? null : (Array.isArray(q.url) ? q.url : [q.url]).map(patternToRegExp);
      return [...tabMap.values()].filter((t) => !pats || pats.some((p) => p.test(t.url))).map((t) => ({ ...t }));
    },
    async get(tabId: number): Promise<FakeTab> {
      const t = tabMap.get(tabId);
      if (!t) throw new Error(`No tab with id: ${tabId}.`);
      return { ...t };
    },
    async create(p: { url?: string; active?: boolean; windowId?: number }): Promise<FakeTab> {
      return { ...addTab(p.url ?? "about:blank", p.windowId ?? 1, p.active ?? true) };
    },
    async reload(tabId: number): Promise<void> {
      if (!tabMap.has(tabId)) throw new Error(`No tab with id: ${tabId}.`);
      reloads.push(tabId);
    },
    async remove(ids: number | number[]): Promise<void> {
      for (const id of Array.isArray(ids) ? ids : [ids]) {
        const t = tabMap.get(id);
        if (!t) throw new Error(`No tab with id: ${id}.`);
        tabMap.delete(id);
        removedTabs.push(id);
        onRemoved.emit(id, { windowId: t.windowId, isWindowClosing: false });
      }
    },
    async sendMessage(tabId: number, message: unknown): Promise<unknown> {
      if (!tabMap.has(tabId)) throw new Error("Could not establish connection. Receiving end does not exist.");
      sentToTabs.push({ tabId, message });
      return undefined;
    },
    onRemoved,
    onUpdated,
  };

  // --- runtime
  const onMessage = new FakeEvent<
    (msg: unknown, sender: { id?: string; tab?: { id?: number } }, sendResponse: (r: unknown) => void) => boolean | void
  >();
  const sentRuntimeMessages: unknown[] = [];
  const runtime = {
    id: "fakeextensionid",
    getURL: (p: string) => `chrome-extension://fakeextensionid/${p.replace(/^\//, "")}`,
    onMessage,
    onInstalled: new FakeEvent<() => void>(),
    onStartup: new FakeEvent<() => void>(),
    async sendMessage(msg: unknown): Promise<unknown> {
      sentRuntimeMessages.push(msg);
      if (!onMessage.hasListeners()) throw new Error("Could not establish connection. Receiving end does not exist.");
      return new Promise<unknown>((resolve) => {
        let done = false;
        const respond = (r: unknown) => {
          if (!done) {
            done = true;
            resolve(r);
          }
        };
        const results = onMessage.emit(msg, { id: "fakeextensionid" }, respond);
        if (!results.includes(true)) respond(undefined);
      });
    },
  };

  // --- webRequest, storage, alarms, action
  const webRequest = {
    onCompleted: new FakeEvent<(d: { tabId: number; url: string; statusCode: number; type: string }) => void>(),
  };
  const storage = { local: createStorageArea(), session: createStorageArea() };
  const alarmMap = new Map<string, { name: string; periodInMinutes?: number }>();
  const alarms = {
    async create(name: string, info: { periodInMinutes?: number }): Promise<void> {
      alarmMap.set(name, { name, ...info });
    },
    async get(name: string) {
      return alarmMap.get(name);
    },
    async clear(name: string): Promise<boolean> {
      return alarmMap.delete(name);
    },
    onAlarm: new FakeEvent<(a: { name: string }) => void>(),
  };
  const badge: { text: string; color: string | null } = { text: "", color: null };
  const action = {
    async setBadgeText(d: { text: string }): Promise<void> {
      badge.text = d.text;
    },
    async setBadgeBackgroundColor(d: { color: string }): Promise<void> {
      badge.color = d.color;
    },
  };

  const api = { cookies, tabs, runtime, webRequest, storage, alarms, action };
  return {
    chrome: api as unknown as typeof chrome,
    api,
    cookieStore,
    cookieSets,
    reloads,
    removedTabs,
    sentToTabs,
    sentRuntimeMessages,
    badge,
    alarmMap,
    tabMap,
    addTab,
    navigate,
  };
}

export type ChromeFake = ReturnType<typeof createChromeFake>;

export function installChromeFake(): ChromeFake {
  const fake = createChromeFake();
  (globalThis as unknown as { chrome: typeof chrome }).chrome = fake.chrome;
  return fake;
}

export async function seedCookie(
  fake: ChromeFake,
  c: { name: string; value: string; domain?: string; path?: string; secure?: boolean; httpOnly?: boolean; expirationDate?: number },
): Promise<void> {
  await fake.api.cookies.set({
    url: `https://${bare(c.domain ?? "claude.ai")}${c.path ?? "/"}`,
    name: c.name,
    value: c.value,
    ...(c.domain ? { domain: c.domain } : {}),
    path: c.path ?? "/",
    secure: c.secure ?? true,
    httpOnly: c.httpOnly ?? false,
    sameSite: "lax",
    ...(c.expirationDate !== undefined ? { expirationDate: c.expirationDate } : {}),
  });
}
