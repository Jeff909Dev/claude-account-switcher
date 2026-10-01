# Claude Account Switcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Manifest V3 Chrome extension that keeps several claude.ai accounts signed in (one saved cookie set per account), switches between them in one click or shortcut, rescues claude.ai links that live in another account, and shows a one-line usage readout per account.

**Architecture:** A background service worker owns every flow (switch, add account, rescue, usage) behind a typed message router; small pure modules (`cookieJar`, `accounts`, `claudeApi`, `usage`) do one job each and are unit-tested against an in-memory `chrome.*` fake. The popup and the claude.ai content script are thin views that send messages and render broadcast `UiState`. Every claude.ai-specific assumption lives in `src/background/claudeApi.ts` (network) and `src/content/anchors.ts` (DOM), so the spike's findings are one-file changes.

**Tech Stack:** TypeScript 5 (strict), esbuild, Vitest + happy-dom, Playwright (Chromium, unpacked extension), vanilla DOM + CSS. Node 22.18, pnpm 10.28.

**Spec:** `docs/superpowers/specs/2026-10-01-claude-account-switcher-design.md` (read it before your task; it wins over this plan if they disagree — say so in your report).

**Visual reference:** the prototypes in the sibling claude-code-usage repo: `prototypes/extension.html` (scenes 1–4), screenshots `prototypes/shots/extension-*.png` and tokens `prototypes/tokens.css`.

## Global Constraints

- Chrome Manifest V3, `minimum_chrome_version` "120"; esbuild `target: "chrome120"`.
- Manifest `permissions` exactly: `cookies`, `storage`, `tabs`, `alarms`, `webRequest`, `declarativeNetRequestWithHostAccess`. Production `host_permissions` exactly `["https://claude.ai/*"]` and content-script `matches` exactly `["https://claude.ai/*"]`.
- Only `scripts/build.mjs --origin=…` may change the origin, and only for the test build in `dist-e2e/` (`http://localhost:4319`). Source code reads the origin from `src/shared/env.ts`, never hard-codes another host.
- Never request any claude.ai log-out endpoint. "Remove account" only deletes local data. Adding an account clears cookies locally.
- Never snapshot, clear or restore the Cloudflare cookies `__cf_bm`, `cf_clearance`, `_cfuvid`.
- No network requests anywhere except the claude.ai origin. No telemetry, analytics or remote code.
- Never log cookie values, tokens or API responses. No `console.log` / `console.info` / `console.debug` in `src/` (`console.warn`/`console.error` with non-sensitive text only).
- Cookies never leave the background: every message to UI carries `PublicAccount` (no `cookies` field).
- All claude.ai paths, cookie names and response shapes live in `src/background/claudeApi.ts`; claude.ai DOM selectors live in `src/content/anchors.ts`.
- Vanilla TypeScript + CSS; no UI framework; no runtime dependencies (devDependencies only).
- UI copy in English; Claude look via `src/shared/tokens.css` (copied from the prototypes); small type; default `style: "app"`, `theme: "system"`.
- Tests never touch real claude.ai. Commands: `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm test:e2e`, `pnpm zip`.
- Code comments must not contain URLs other than `https://claude.ai…`, and must say "log out" (two words) — `tests/unit/guardrails.test.ts` enforces this.
- Commits use conventional prefixes (`feat:`, `fix:`, `test:`, `chore:`, `docs:`). Never run `gh repo create`, `gh release create` or `vercel deploy` — the controller does that after final review.

## Review Focus

1. **Switching while a claude.ai tab is streaming a reply, with claude.ai tabs in two windows** — the switch must finish for every claude.ai tab in every window (cookies swapped first, then all tabs reloaded in one pass; one tab vanishing mid-switch must not abort the others or leave mixed accounts). Pinned in Task 5 (`reloads claude.ai tabs in every window`, `keeps reloading … one tab vanished`).
2. **A saved account whose session expired or was revoked** — switching reports "signed out", the browser stays on the previous account (rollback) and the row offers "sign in again"; nothing is left half-switched. Pinned in Task 5 (`expired`, `revoked`) and Task 10 (signed-out row).
3. **The browser's login changed behind the extension's back** (user signed into another account by hand, or adds an account that is already saved) — never store one account's cookies under another account's id, never destroy an unknown login (save it first), never duplicate an account. Pinned in Task 5 (`never saves one account's cookies under another`, `saves an unknown signed-in account`) and Task 6 (`re-adding an account updates it`).
4. **Popup closed or service worker restarted mid-flow, magic link opened in another tab or another browser** — the background owns and persists the flow; it completes from any tab, and a stuck add flow times out after 15 min back to the previous account. Pinned in Task 6 (`survives a service-worker restart`, `closing the login tab keeps waiting`, `times out`) and Task 9 (`switch returns at once and finishes …`).
5. **Typing on claude.ai with a Spanish Mac keyboard** (⌥2 = "@", ⌥1 = "|", ⌥3 = "#") — in-page ⌥1–9 shortcuts must never fire inside the composer or any editable field. Pinned in Task 11 (`never steals ⌥digits while typing`).

---

## File map

```
package.json, tsconfig.json, vitest.config.ts, playwright.config.ts, .gitignore, LICENSE, README.md
scripts/build.mjs            esbuild bundles + manifest/origin rewrite + static copy
scripts/icons.mjs            generates src/icons/*.png (pure Node, no deps)
src/manifest.json            production manifest (build rewrites origin for e2e only)
src/shared/env.ts            CLAUDE_ORIGIN / HOST / match patterns (build-time define)
src/shared/types.ts          all shared types + ACCOUNT_COLORS
src/shared/messages.ts       Request / Push / Reply contracts + sendToBackground
src/shared/resourceKey.ts    parse claude.ai resource URLs (pure)
src/shared/html.ts           esc(), avatarHtml()
src/shared/usageFormat.ts    levelOf, formatAge, formatReset, resetTitle (pure)
src/shared/tokens.css        copy of prototypes/tokens.css
src/background/claudeApi.ts  every claude.ai network assumption (identity, usage, resource-miss)
src/background/cookieJar.ts  snapshot / clear / restore over chrome.cookies
src/background/accounts.ts   AccountStore over chrome.storage.local
src/background/switcher.ts   Switcher + saveCurrentSession + reloadClaudeTabs
src/background/addAccount.ts AddAccountFlow state machine (persisted in storage.session)
src/background/rescue.ts     RescueTracker, openAs, probe
src/background/usage.ts      parseUsage, badgeFor, UsageService
src/background/router.ts     createRouter, buildUiState, isRequest, broadcastPush
src/background/index.ts      wiring only
src/popup/popup.html, popup.css, view.ts (pure render), popup.ts (mount/events), main.ts (bootstrap)
src/content/styles.ts, host.ts, anchors.ts, keys.ts, switcherUi.ts, banner.ts, main.ts
src/icons/icon-{16,32,48,128}.png (generated)
tests/fakes/chrome.ts        in-memory chrome.* fake
tests/fixtures/bootstrap.json, usage-limits.json
tests/unit/*.test.ts, tests/unit/harness.ts
tests/e2e/fakeClaude.ts, fixtures.ts, switching.spec.ts, site.spec.ts
docs/notes/spike.md          manual checklist Jeff runs on real claude.ai
site/index.html, site/tokens.css, site/screenshot.png
```

---

### Task 1: Scaffold, shared contracts, chrome fake, build, guardrails, spike checklist

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`
- Create: `scripts/build.mjs`, `src/manifest.json`
- Create: `src/shared/env.ts`, `src/shared/types.ts`, `src/shared/messages.ts`, `src/shared/tokens.css` (copy)
- Create stubs: `src/background/index.ts`, `src/popup/main.ts`, `src/popup/popup.html`, `src/popup/popup.css`, `src/content/main.ts`
- Create: `tests/fakes/chrome.ts`
- Test: `tests/unit/chromeFake.test.ts`, `tests/unit/build.test.ts`, `tests/unit/guardrails.test.ts`
- Create: `docs/notes/spike.md`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `src/shared/env.ts`: `CLAUDE_ORIGIN: string` ("https://claude.ai" unless built with `--origin`), `CLAUDE_HOST: string`, `CLAUDE_TAB_PATTERN: string` (e.g. `"https://claude.ai/*"`), `CLAUDE_API_PATTERN: string` (e.g. `"https://claude.ai/api/*"`).
  - `src/shared/types.ts`: `SameSite`, `StoredCookie`, `Identity`, `AccountStatus`, `Account`, `PublicAccount`, `Prefs`, `StoreState`, `UsageLimit`, `UsageSnapshot`, `AddPhase`, `AddFlowPublic`, `UiState`, `ResourceKind`, `ProbeResult`, `RescueInfo`, `ACCOUNT_COLORS` (exact definitions in Step 5).
  - `src/shared/messages.ts`: `Request` union, `Push` union, `Reply<T>`, `sendToBackground<T>(req: Request): Promise<T>`.
  - `tests/fakes/chrome.ts`: `createChromeFake()`, `installChromeFake(): ChromeFake`, `seedCookie(fake, cookie)`, `patternToRegExp(pattern)`, `FakeEvent`, `type ChromeFake` with fields `chrome`, `api`, `cookieStore`, `cookieSets`, `reloads`, `sentToTabs`, `removedTabs`, `sentRuntimeMessages`, `sessionRules`, `badge`, `alarmMap`, `tabMap`, `addTab(url, windowId?, active?)`, `navigate(tabId, url)`.
  - `scripts/build.mjs [--origin=URL] [--out=DIR] [--dev]` writes `background.js` (ESM), `popup.js` + `content.js` (IIFE), `manifest.json`, `popup.html`, `popup.css`, `tokens.css`, `icons/` (if present).

- [ ] **Step 1: Create the package and install dev dependencies**

`package.json`:

```json
{
  "name": "claude-account-switcher",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "license": "MIT",
  "scripts": {
    "build": "node scripts/build.mjs",
    "build:e2e": "node scripts/build.mjs --origin=http://localhost:4319 --out=dist-e2e",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:e2e": "pnpm build:e2e && playwright test",
    "zip": "pnpm build && rm -f claude-account-switcher.zip && cd dist && zip -qr ../claude-account-switcher.zip ."
  }
}
```

Run: `pnpm add -D typescript esbuild vitest happy-dom @types/chrome @types/node`
Expected: `devDependencies` filled, `pnpm-lock.yaml` created.

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "types": ["chrome", "node"]
  },
  "include": ["src", "tests", "*.config.ts"]
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
    restoreMocks: true,
  },
});
```

`.gitignore`:

```
node_modules/
dist/
dist-e2e/
claude-account-switcher.zip
test-results/
playwright-report/
```

- [ ] **Step 2: Write the failing tests**

`tests/unit/chromeFake.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { createChromeFake, patternToRegExp, type ChromeFake } from "../fakes/chrome";

describe("chrome fake", () => {
  let fake: ChromeFake;
  beforeEach(() => {
    fake = createChromeFake();
  });

  it("stores host-only and domain cookies like Chrome", async () => {
    await fake.api.cookies.set({ url: "https://claude.ai/", name: "a", value: "1" });
    await fake.api.cookies.set({ url: "https://claude.ai/", name: "b", value: "2", domain: "claude.ai" });
    const all = await fake.api.cookies.getAll({ domain: "claude.ai" });
    expect(all.find((c) => c.name === "a")).toMatchObject({ domain: "claude.ai", hostOnly: true });
    expect(all.find((c) => c.name === "b")).toMatchObject({ domain: ".claude.ai", hostOnly: false });
  });

  it("drops a cookie set with a past expiration", async () => {
    await fake.api.cookies.set({ url: "https://claude.ai/", name: "old", value: "x", expirationDate: Date.now() / 1000 - 10 });
    expect(await fake.api.cookies.getAll({ name: "old" })).toEqual([]);
  });

  it("removes by url + name and emits onChanged", async () => {
    const events: { removed: boolean; name: string }[] = [];
    fake.api.cookies.onChanged.addListener((i) => events.push({ removed: i.removed, name: i.cookie.name }));
    await fake.api.cookies.set({ url: "https://claude.ai/", name: "s", value: "1", domain: ".claude.ai" });
    await fake.api.cookies.remove({ url: "https://claude.ai/", name: "s" });
    expect(await fake.api.cookies.getAll({ domain: "claude.ai" })).toEqual([]);
    expect(events).toEqual([
      { removed: false, name: "s" },
      { removed: true, name: "s" },
    ]);
  });

  it("matches url patterns on any port when the pattern has none", () => {
    expect(patternToRegExp("http://localhost/*").test("http://localhost:4319/new")).toBe(true);
    expect(patternToRegExp("https://claude.ai/*").test("https://claude.ai/chat/x")).toBe(true);
    expect(patternToRegExp("https://claude.ai/*").test("https://evil.example/claude.ai/")).toBe(false);
  });

  it("queries tabs by pattern across windows", async () => {
    fake.addTab("https://claude.ai/new", 1);
    fake.addTab("https://claude.ai/chat/1", 2);
    fake.addTab("https://example.com/", 1);
    const tabs = await fake.api.tabs.query({ url: "https://claude.ai/*" });
    expect(tabs.map((t) => t.windowId).sort()).toEqual([1, 2]);
  });

  it("runtime.sendMessage rejects when nobody listens, like Chrome", async () => {
    await expect(fake.api.runtime.sendMessage({ type: "x" })).rejects.toThrow(/Receiving end does not exist/);
  });

  it("storage.get supports string, array and defaults", async () => {
    await fake.api.storage.local.set({ a: 1, b: { c: 2 } });
    expect(await fake.api.storage.local.get("a")).toEqual({ a: 1 });
    expect(await fake.api.storage.local.get(["a", "zz"])).toEqual({ a: 1 });
    expect(await fake.api.storage.local.get({ zz: 9 })).toEqual({ zz: 9 });
  });

  it("records badge and alarms", async () => {
    await fake.api.action.setBadgeText({ text: "91%" });
    await fake.api.action.setBadgeBackgroundColor({ color: "#ff6b80" });
    await fake.api.alarms.create("tick", { periodInMinutes: 15 });
    expect(fake.badge).toEqual({ text: "91%", color: "#ff6b80" });
    expect(await fake.api.alarms.get("tick")).toEqual({ name: "tick", periodInMinutes: 15 });
  });
});
```

`tests/unit/build.test.ts`:

```ts
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function buildInto(...args: string[]): string {
  const out = mkdtempSync(join(tmpdir(), "cas-build-"));
  execFileSync(process.execPath, ["scripts/build.mjs", `--out=${out}`, ...args], { stdio: "pipe" });
  return out;
}

describe("build", () => {
  it("production build targets only https://claude.ai with the exact permissions", () => {
    const out = buildInto();
    const m = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
    expect(m.manifest_version).toBe(3);
    expect(m.host_permissions).toEqual(["https://claude.ai/*"]);
    expect(m.content_scripts[0].matches).toEqual(["https://claude.ai/*"]);
    expect([...m.permissions].sort()).toEqual(
      ["alarms", "cookies", "declarativeNetRequestWithHostAccess", "storage", "tabs", "webRequest"].sort(),
    );
    expect(m.commands._execute_action.suggested_key.default).toBe("Alt+Shift+A");
    expect(readFileSync(join(out, "background.js"), "utf8")).toContain("https://claude.ai");
    for (const f of ["popup.html", "popup.css", "popup.js", "content.js", "tokens.css"]) {
      expect(readFileSync(join(out, f), "utf8").length).toBeGreaterThan(0);
    }
  });

  it("e2e build points at the local fake origin", () => {
    const out = buildInto("--origin=http://localhost:4319");
    const m = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
    expect(m.host_permissions).toEqual(["http://localhost/*"]);
    expect(m.content_scripts[0].matches).toEqual(["http://localhost/*"]);
    expect(readFileSync(join(out, "background.js"), "utf8")).toContain("http://localhost:4319");
  });
});
```

`tests/unit/guardrails.test.ts`:

```ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? tsFiles(p) : p.endsWith(".ts") ? [p] : [];
  });
}
const SRC = tsFiles("src");

describe("guardrails", () => {
  it("never references a claude.ai log-out endpoint", () => {
    for (const f of SRC) expect(readFileSync(f, "utf8"), f).not.toMatch(/logout/i);
  });

  it("only ever talks to claude.ai", () => {
    for (const f of SRC) {
      const urls = readFileSync(f, "utf8").match(/https?:\/\/[^\s"'`)<]+/g) ?? [];
      for (const u of urls) expect(u.startsWith("https://claude.ai"), `${f}: ${u}`).toBe(true);
    }
  });

  it("has no console.log / info / debug", () => {
    for (const f of SRC) expect(readFileSync(f, "utf8"), f).not.toMatch(/console\.(log|info|debug)\(/);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm vitest run`
Expected: FAIL — `Cannot find module '../fakes/chrome'`, `scripts/build.mjs` not found; guardrails fails with `ENOENT: no such file or directory, scandir 'src'`.

- [ ] **Step 4: Copy the design tokens**

Run: `mkdir -p src/shared && cp <claude-code-usage repo>/prototypes/tokens.css src/shared/tokens.css`
Expected: file exists (≈150 lines, starts with `/* Shared design tokens`).

- [ ] **Step 5: Write the shared contracts**

`src/shared/env.ts`:

```ts
/** Build-time origin. Production builds use claude.ai; the e2e build points at a local fake. */
declare const __CLAUDE_ORIGIN__: string | undefined;

export const CLAUDE_ORIGIN: string = typeof __CLAUDE_ORIGIN__ === "string" ? __CLAUDE_ORIGIN__ : "https://claude.ai";
const parsed = new URL(CLAUDE_ORIGIN);
export const CLAUDE_HOST: string = parsed.hostname;
/** Match pattern for every claude.ai page (a pattern without port matches any port). */
export const CLAUDE_TAB_PATTERN = `${parsed.protocol}//${parsed.hostname}/*`;
export const CLAUDE_API_PATTERN = `${parsed.protocol}//${parsed.hostname}/api/*`;
```

`src/shared/types.ts`:

```ts
export type SameSite = "no_restriction" | "lax" | "strict" | "unspecified";

export interface StoredCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: SameSite;
  hostOnly: boolean;
  expirationDate?: number; // seconds since epoch; absent = session cookie
}

export interface Identity {
  accountUuid: string;
  email: string;
  name: string;
  orgUuid: string;
  orgName: string;
  plan: string; // "Max 20x" | "Max 5x" | "Max" | "Pro" | "Team" | "Enterprise" | "Free"
}

export type AccountStatus = "ok" | "signedOut";

export interface Account {
  id: string; // accountUuid
  email: string;
  name: string;
  label: string;
  color: number; // index into ACCOUNT_COLORS
  plan: string;
  orgUuid: string;
  cookies: StoredCookie[];
  savedAt: number; // ms
  status: AccountStatus;
}

export type PublicAccount = Omit<Account, "cookies">;

export interface Prefs {
  theme: "system" | "dark" | "light";
  style: "app" | "cli";
  inPageSwitcher: boolean;
  badge: boolean;
  rescueProbe: boolean;
}

export interface StoreState {
  version: 1;
  accounts: Record<string, Account>;
  order: string[];
  activeId: string | null;
  resourceMap: Record<string, string>; // resourceKey -> accountId
  prefs: Prefs;
}

export interface UsageLimit {
  kind: string; // "session" | "weekly_all" | "weekly_scoped" | other
  label: string; // "5h" | "week" | model name e.g. "Fable"
  percent: number; // 0..100
  resetsAt: string | null; // ISO date
}

export interface UsageSnapshot {
  limits: UsageLimit[];
  fetchedAt: number; // ms
}

export type AddPhase = "idle" | "waitingLogin" | "saved" | "mismatch" | "error";

export interface AddFlowPublic {
  phase: AddPhase;
  targetAccountId: string | null;
  savedAccountId: string | null;
  isNew: boolean;
  mismatchEmail: string | null;
  message: string | null;
}

export interface UiState {
  accounts: PublicAccount[]; // in display order
  activeId: string | null;
  prefs: Prefs;
  switchingTo: string | null;
  lastSwitch: { accountId: string; reloadedTabs: number; at: number } | null;
  add: AddFlowPublic;
  usage: Record<string, UsageSnapshot>;
  error: string | null;
}

export type ResourceKind = "artifact" | "chat" | "project" | "codeArtifact";

export interface ProbeResult {
  accountId: string;
  outcome: "found" | "notFound" | "signedOut" | "error";
}

export interface RescueInfo {
  resourceKey: string;
  kind: ResourceKind;
  currentAccountId: string | null;
  candidates: PublicAccount[]; // other accounts, remembered one first
  rememberedAccountId: string | null;
}

export const ACCOUNT_COLORS = ["#c96442", "#7d8b4e", "#5b7aa6", "#8e5a8a", "#b0893e", "#4f8f87"] as const;
```

`src/shared/messages.ts`:

```ts
import type { Prefs, RescueInfo, UiState } from "./types";

/** UI → background. */
export type Request =
  | { type: "getState" }
  | { type: "switch"; accountId: string }
  | { type: "addAccount:start"; targetAccountId?: string }
  | { type: "addAccount:cancel" }
  | { type: "addAccount:resolveMismatch"; addAsNew: boolean }
  | { type: "addAccount:dismiss" }
  | { type: "account:update"; accountId: string; patch: { label?: string; color?: number } }
  | { type: "account:remove"; accountId: string }
  | { type: "account:reorder"; order: string[] }
  | { type: "prefs:update"; patch: Partial<Prefs> }
  | { type: "rescue:get" }
  | { type: "rescue:openAs"; accountId: string; resourceKey: string }
  | { type: "rescue:probe"; resourceKey: string };

/** Background → UI broadcasts. */
export type Push = { type: "state"; state: UiState } | { type: "rescue:show"; rescue: RescueInfo };

export type Reply<T = unknown> = { ok: true; data: T } | { ok: false; error: string };

export async function sendToBackground<T = unknown>(req: Request): Promise<T> {
  const reply = (await chrome.runtime.sendMessage(req)) as Reply<T> | undefined;
  if (!reply) throw new Error("No reply from the extension background");
  if (!reply.ok) throw new Error(reply.error);
  return reply.data;
}
```

- [ ] **Step 6: Write the chrome fake**

`tests/fakes/chrome.ts`:

```ts
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
    TAB_ID_NONE: -1,
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

  // --- declarativeNetRequest, webRequest, storage, alarms, action
  const sessionRules: { id: number }[] = [];
  const declarativeNetRequest = {
    async updateSessionRules(o: { addRules?: { id: number }[]; removeRuleIds?: number[] }): Promise<void> {
      for (const id of o.removeRuleIds ?? []) {
        const i = sessionRules.findIndex((r) => r.id === id);
        if (i >= 0) sessionRules.splice(i, 1);
      }
      for (const r of o.addRules ?? []) {
        if (sessionRules.some((x) => x.id === r.id)) throw new Error(`Rule with id ${r.id} already exists`);
        sessionRules.push(structuredClone(r));
      }
    },
    async getSessionRules(): Promise<{ id: number }[]> {
      return structuredClone(sessionRules);
    },
  };
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

  const api = { cookies, tabs, runtime, declarativeNetRequest, webRequest, storage, alarms, action };
  return {
    chrome: api as unknown as typeof chrome,
    api,
    cookieStore,
    cookieSets,
    reloads,
    removedTabs,
    sentToTabs,
    sentRuntimeMessages,
    sessionRules,
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
```

- [ ] **Step 7: Write the build script, manifest and entry stubs**

`scripts/build.mjs`:

```js
#!/usr/bin/env node
// Bundles the extension. `--origin` exists only for the e2e build (a local fake claude.ai).
import { build } from "esbuild";
import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.length ? v.join("=") : "true"];
  }),
);
const origin = new URL(args.origin ?? "https://claude.ai");
const out = args.out ?? "dist";
const pattern = `${origin.protocol}//${origin.hostname}/*`;

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

const common = {
  bundle: true,
  target: "chrome120",
  define: { __CLAUDE_ORIGIN__: JSON.stringify(origin.origin) },
  logLevel: "warning",
  legalComments: "none",
  sourcemap: args.dev === "true" ? "inline" : false,
};
await Promise.all([
  build({ ...common, entryPoints: ["src/background/index.ts"], outfile: `${out}/background.js`, format: "esm" }),
  build({ ...common, entryPoints: ["src/popup/main.ts"], outfile: `${out}/popup.js`, format: "iife" }),
  build({ ...common, entryPoints: ["src/content/main.ts"], outfile: `${out}/content.js`, format: "iife" }),
]);

const manifest = JSON.parse(await readFile("src/manifest.json", "utf8"));
manifest.host_permissions = [pattern];
for (const cs of manifest.content_scripts) cs.matches = [pattern];
await writeFile(`${out}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);

await cp("src/popup/popup.html", `${out}/popup.html`);
await cp("src/popup/popup.css", `${out}/popup.css`);
await cp("src/shared/tokens.css", `${out}/tokens.css`);
const exists = (p) => access(p).then(() => true, () => false);
if (await exists("src/icons")) await cp("src/icons", `${out}/icons`, { recursive: true });
```

`src/manifest.json`:

```json
{
  "manifest_version": 3,
  "name": "Claude Account Switcher",
  "short_name": "Claude accounts",
  "version": "0.1.0",
  "description": "Keep several claude.ai accounts signed in and switch between them instantly.",
  "minimum_chrome_version": "120",
  "permissions": ["cookies", "storage", "tabs", "alarms", "webRequest", "declarativeNetRequestWithHostAccess"],
  "host_permissions": ["https://claude.ai/*"],
  "background": { "service_worker": "background.js", "type": "module" },
  "action": { "default_popup": "popup.html", "default_title": "Claude accounts" },
  "commands": {
    "_execute_action": {
      "suggested_key": { "default": "Alt+Shift+A", "mac": "Alt+Shift+A" },
      "description": "Open the account switcher"
    }
  },
  "content_scripts": [{ "matches": ["https://claude.ai/*"], "js": ["content.js"], "run_at": "document_idle" }]
}
```

`src/background/index.ts` (stub, replaced in Task 9):

```ts
import { CLAUDE_ORIGIN } from "../shared/env";

export const BUILD_ORIGIN = CLAUDE_ORIGIN;
```

`src/popup/main.ts` and `src/content/main.ts` (stubs, replaced in Tasks 10 and 11):

```ts
export {};
```

`src/popup/popup.html` (final — later tasks keep it):

```html
<!doctype html>
<html lang="en" data-style="app">
  <head>
    <meta charset="utf-8" />
    <title>Claude accounts</title>
    <link rel="stylesheet" href="tokens.css" />
    <link rel="stylesheet" href="popup.css" />
  </head>
  <body>
    <div id="app" class="popup"></div>
    <script src="popup.js"></script>
  </body>
</html>
```

`src/popup/popup.css` (stub, replaced in Task 10):

```css
body { width: 320px; }
```

- [ ] **Step 8: Run tests and typecheck**

Run: `pnpm vitest run && pnpm typecheck`
Expected: all tests in `chromeFake.test.ts`, `build.test.ts`, `guardrails.test.ts` PASS; `tsc` exits 0.

- [ ] **Step 9: Write the manual spike checklist**

`docs/notes/spike.md`:

````markdown
# Spike — confirm claude.ai facts (Jeff, ~15 min, real claude.ai)

Everything the extension assumes about claude.ai lives in `src/background/claudeApi.ts` and
`src/content/anchors.ts`. Fill the Result column, then update those two files (and the fixtures in
`tests/fixtures/`) — nothing else should need to change.

| # | Check | How | Result |
|---|---|---|---|
| 1 | Cookie names | DevTools on claude.ai → Application → Cookies → `https://claude.ai`. List every name, mark HttpOnly ones. Confirm the session cookie is `sessionKey`. | |
| 2 | Identity endpoint | Console on claude.ai: `await (await fetch('/api/bootstrap')).json()`. Note the paths of account uuid, email, name, memberships[].organization.{uuid,name,capabilities,rate_limit_tier}. If 404, try `/api/account` and `/api/organizations`. Save a scrubbed copy as `tests/fixtures/bootstrap.json`. | |
| 3 | Usage endpoint | Console: `const org = (await (await fetch('/api/organizations')).json())[0].uuid; await (await fetch('/api/organizations/' + org + '/usage')).json()`. Note whether it has `limits[]` and/or `five_hour` / `seven_day` / `seven_day_<model>`. Save scrubbed as `tests/fixtures/usage-limits.json`. | |
| 4 | Resource miss | DevTools Network (Fetch/XHR) open, then open a link from ANOTHER account: an artifact (`/artifact/…`), a chat (`/chat/…`), a project (`/project/…`), a Claude Code artifact (`/code/artifact/…`). For each: the API URL that answers 403/404 and whether it contains the id from the page URL. | |
| 5 | Extension cookies from the service worker | After Task 9, load `dist/` unpacked, open the service worker console: `(await fetch('https://claude.ai/api/bootstrap', {credentials:'include'})).status` → expect 200 while signed in. If 401, the identity check must move into a claude.ai tab (needs the `scripting` permission — spec change). | |
| 6 | DNR can set Cookie on extension requests | Service worker console, with ≥2 saved accounts: see snippet below. Expect `200 true`. If not, keep `rescueProbe` off (Open as… still works). | |
| 7 | Stale UI after a switch | Switch accounts with two claude.ai tabs open. Does any tab show the old account's chats after reload? If yes, note which storage (Application → Local Storage) holds them. | |
| 8 | Sidebar anchor | Inspect the account button at the bottom of claude.ai's sidebar. Note a stable selector (prefer `data-testid`). Put it first in `ANCHOR_SELECTORS`. | |

Snippet for #6:

```js
const s = (await chrome.storage.local.get("cas:state"))["cas:state"];
const other = s.accounts[s.order.find((id) => id !== s.activeId)];
const header = other.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
await chrome.declarativeNetRequest.updateSessionRules({ addRules: [{ id: 9999, priority: 1,
  action: { type: "modifyHeaders", requestHeaders: [{ header: "cookie", operation: "set", value: header }] },
  condition: { urlFilter: "cas_probe=spike", tabIds: [chrome.tabs.TAB_ID_NONE], resourceTypes: ["xmlhttprequest"] } }] });
const r = await fetch("https://claude.ai/api/bootstrap?cas_probe=spike", { credentials: "omit" });
console.log(r.status, (await r.json()).account?.email_address === other.email);
await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [9999] });
```
````

- [ ] **Step 10: Commit**

```bash
git add package.json pnpm-lock.yaml tsconfig.json vitest.config.ts .gitignore scripts src tests docs/notes
git commit -m "chore: scaffold extension, shared contracts, chrome fake and build"
```

---

### Task 2: claudeApi — identity, usage fetch and resource-miss helpers

**Files:**
- Create: `src/background/claudeApi.ts`
- Create: `tests/fixtures/bootstrap.json`
- Test: `tests/unit/claudeApi.test.ts`

**Interfaces:**
- Consumes: `CLAUDE_ORIGIN`, `CLAUDE_HOST` (Task 1), `Identity` (Task 1).
- Produces (`src/background/claudeApi.ts`):
  - `SESSION_COOKIE = "sessionKey"`, `IDENTITY_PATH = "/api/bootstrap"`, `LOGIN_PATH = "/login"`, `PRESERVED_COOKIES: ReadonlySet<string>`
  - `type FetchLike = (input: string, init?: RequestInit) => Promise<Response>`
  - `class AuthError extends Error { status: number }`, `class NetworkError extends Error`
  - `planLabel(org: { capabilities?: string[]; rateLimitTier?: string | null }): string`
  - `parseIdentity(json: unknown, preferredOrgUuid?: string | null): Identity`
  - `whoAmI(opts?: { fetchImpl?: FetchLike; preferredOrgUuid?: string | null }): Promise<Identity>`
  - `usagePath(orgUuid: string): string`, `fetchUsageJson(orgUuid: string, fetchImpl?: FetchLike): Promise<unknown>`
  - `isResourceMiss(apiUrl: string, statusCode: number, resourceId: string): boolean`
  - `retargetOrg(apiUrl: string, orgUuid: string): string`
  - `loginUrl(): string`, `hostMatchesClaude(cookieDomain: string): boolean`

- [ ] **Step 1: Write the fixture (assumed shape — the spike replaces it with a scrubbed real one)**

`tests/fixtures/bootstrap.json`:

```json
{
  "account": {
    "uuid": "11111111-1111-4111-8111-111111111111",
    "email_address": "jeff@example.com",
    "full_name": "Jeff Example",
    "display_name": "Jeff",
    "memberships": [
      {
        "organization": {
          "uuid": "22222222-2222-4222-8222-222222222222",
          "name": "API org",
          "capabilities": ["api"],
          "rate_limit_tier": null
        }
      },
      {
        "organization": {
          "uuid": "33333333-3333-4333-8333-333333333333",
          "name": "jeff@example.com's Organization",
          "capabilities": ["chat", "claude_max"],
          "rate_limit_tier": "default_claude_max_20x"
        }
      }
    ]
  }
}
```

- [ ] **Step 2: Write the failing test**

`tests/unit/claudeApi.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import {
  AuthError,
  NetworkError,
  fetchUsageJson,
  hostMatchesClaude,
  isResourceMiss,
  loginUrl,
  parseIdentity,
  planLabel,
  retargetOrg,
  whoAmI,
} from "../../src/background/claudeApi";
import bootstrap from "../fixtures/bootstrap.json";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("parseIdentity", () => {
  it("picks the chat organization and maps the plan", () => {
    expect(parseIdentity(bootstrap)).toEqual({
      accountUuid: "11111111-1111-4111-8111-111111111111",
      email: "jeff@example.com",
      name: "Jeff Example",
      orgUuid: "33333333-3333-4333-8333-333333333333",
      orgName: "jeff@example.com's Organization",
      plan: "Max 20x",
    });
  });

  it("honours a preferred org when it is a chat org", () => {
    const two = structuredClone(bootstrap);
    two.account.memberships.push({
      organization: { uuid: "44444444-4444-4444-8444-444444444444", name: "Team", capabilities: ["chat", "raven"], rate_limit_tier: null },
    });
    expect(parseIdentity(two, "44444444-4444-4444-8444-444444444444")).toMatchObject({ orgName: "Team", plan: "Team" });
  });

  it("rejects a response without account uuid or email", () => {
    expect(() => parseIdentity({ account: { uuid: "x" } })).toThrow(/identity/i);
    expect(() => parseIdentity(null)).toThrow(/identity/i);
  });
});

describe("planLabel", () => {
  it.each([
    [{ rateLimitTier: "default_claude_max_20x" }, "Max 20x"],
    [{ rateLimitTier: "default_claude_max_5x" }, "Max 5x"],
    [{ capabilities: ["chat", "claude_max"] }, "Max"],
    [{ capabilities: ["chat", "raven"] }, "Team"],
    [{ capabilities: ["chat", "enterprise"] }, "Enterprise"],
    [{ capabilities: ["chat", "claude_pro"] }, "Pro"],
    [{ capabilities: ["chat"] }, "Free"],
  ])("%j → %s", (org, label) => expect(planLabel(org)).toBe(label));
});

describe("whoAmI", () => {
  it("calls the identity endpoint with cookies", async () => {
    const fetchImpl = vi.fn(async () => json(200, bootstrap));
    await whoAmI({ fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith("https://claude.ai/api/bootstrap", expect.objectContaining({ credentials: "include" }));
  });

  it("maps 401/403 to AuthError and other failures to NetworkError", async () => {
    await expect(whoAmI({ fetchImpl: async () => json(401, {}) })).rejects.toBeInstanceOf(AuthError);
    await expect(whoAmI({ fetchImpl: async () => json(403, {}) })).rejects.toBeInstanceOf(AuthError);
    await expect(whoAmI({ fetchImpl: async () => json(502, {}) })).rejects.toBeInstanceOf(NetworkError);
    await expect(whoAmI({ fetchImpl: async () => Promise.reject(new TypeError("offline")) })).rejects.toBeInstanceOf(NetworkError);
  });
});

describe("fetchUsageJson", () => {
  it("fetches the org usage endpoint", async () => {
    const fetchImpl = vi.fn(async () => json(200, { five_hour: { utilization: 3 } }));
    expect(await fetchUsageJson("org-1", fetchImpl)).toEqual({ five_hour: { utilization: 3 } });
    expect(fetchImpl).toHaveBeenCalledWith("https://claude.ai/api/organizations/org-1/usage", expect.objectContaining({ credentials: "include" }));
  });

  it("throws AuthError on 401", async () => {
    await expect(fetchUsageJson("org-1", async () => json(401, {}))).rejects.toBeInstanceOf(AuthError);
  });
});

describe("resource helpers", () => {
  it("detects a 403/404 claude.ai API call about the page's resource", () => {
    const api = "https://claude.ai/api/organizations/org-a/artifacts/7f3c9a/versions";
    expect(isResourceMiss(api, 404, "7f3c9a")).toBe(true);
    expect(isResourceMiss(api, 403, "7f3c9a")).toBe(true);
    expect(isResourceMiss(api, 200, "7f3c9a")).toBe(false);
    expect(isResourceMiss(api, 404, "other")).toBe(false);
    expect(isResourceMiss("https://claude.ai/artifact/7f3c9a", 404, "7f3c9a")).toBe(false);
    expect(isResourceMiss("https://evil.example/api/7f3c9a", 404, "7f3c9a")).toBe(false);
    expect(isResourceMiss("not a url", 404, "7f3c9a")).toBe(false);
  });

  it("retargets the organization segment", () => {
    expect(retargetOrg("https://claude.ai/api/organizations/org-a/chat_conversations/c1?x=1", "org-b")).toBe(
      "https://claude.ai/api/organizations/org-b/chat_conversations/c1?x=1",
    );
    expect(retargetOrg("https://claude.ai/api/artifacts/a1", "org-b")).toBe("https://claude.ai/api/artifacts/a1");
  });

  it("builds the login url and matches cookie domains", () => {
    expect(loginUrl()).toBe("https://claude.ai/login");
    expect(hostMatchesClaude(".claude.ai")).toBe(true);
    expect(hostMatchesClaude("claude.ai")).toBe(true);
    expect(hostMatchesClaude(".example.com")).toBe(false);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/claudeApi.test.ts`
Expected: FAIL — `Cannot find module '../../src/background/claudeApi'`.

- [ ] **Step 4: Implement**

`src/background/claudeApi.ts`:

```ts
/**
 * Every assumption about claude.ai's network surface lives here.
 * After running docs/notes/spike.md, update this file and tests/fixtures — nothing else.
 */
import { CLAUDE_HOST, CLAUDE_ORIGIN } from "../shared/env";
import type { Identity } from "../shared/types";

export const SESSION_COOKIE = "sessionKey";
export const IDENTITY_PATH = "/api/bootstrap";
export const LOGIN_PATH = "/login";
/** Browser-bound Cloudflare cookies: never saved, cleared or restored. */
export const PRESERVED_COOKIES: ReadonlySet<string> = new Set(["__cf_bm", "cf_clearance", "_cfuvid"]);

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
const defaultFetch: FetchLike = (input, init) => fetch(input, init);

export class AuthError extends Error {
  constructor(readonly status: number) {
    super(`claude.ai answered ${status}`);
    this.name = "AuthError";
  }
}

export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetworkError";
  }
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export function planLabel(org: { capabilities?: string[]; rateLimitTier?: string | null }): string {
  const tier = org.rateLimitTier ?? "";
  const caps = org.capabilities ?? [];
  if (tier.includes("max_20x")) return "Max 20x";
  if (tier.includes("max_5x")) return "Max 5x";
  if (caps.includes("claude_max")) return "Max";
  if (caps.includes("raven")) return "Team";
  if (caps.includes("enterprise")) return "Enterprise";
  if (caps.includes("claude_pro")) return "Pro";
  return "Free";
}

interface RawOrg {
  uuid?: unknown;
  name?: unknown;
  capabilities?: unknown;
  rate_limit_tier?: unknown;
}

export function parseIdentity(json: unknown, preferredOrgUuid?: string | null): Identity {
  const account = (json as { account?: Record<string, unknown> } | null)?.account;
  const uuid = str(account?.uuid);
  const email = str(account?.email_address);
  if (!uuid || !email) throw new Error("Unexpected identity response: missing account uuid or email");
  const memberships = Array.isArray(account?.memberships) ? (account.memberships as { organization?: RawOrg }[]) : [];
  const orgs = memberships.map((m) => m.organization).filter((o): o is RawOrg => !!o && typeof o.uuid === "string");
  const chatOrgs = orgs.filter((o) => strs(o.capabilities).includes("chat"));
  const pool = chatOrgs.length > 0 ? chatOrgs : orgs;
  const org = pool.find((o) => o.uuid === preferredOrgUuid) ?? pool[0];
  return {
    accountUuid: uuid,
    email,
    name: str(account?.full_name) ?? str(account?.display_name) ?? email,
    orgUuid: str(org?.uuid) ?? "",
    orgName: str(org?.name) ?? "",
    plan: planLabel({ capabilities: strs(org?.capabilities), rateLimitTier: str(org?.rate_limit_tier) ?? null }),
  };
}

async function getJson(fetchImpl: FetchLike, path: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchImpl(`${CLAUDE_ORIGIN}${path}`, {
      credentials: "include",
      cache: "no-store",
      headers: { accept: "application/json" },
    });
  } catch (e) {
    throw new NetworkError(e instanceof Error ? e.message : String(e));
  }
  if (res.status === 401 || res.status === 403) throw new AuthError(res.status);
  if (!res.ok) throw new NetworkError(`claude.ai answered ${res.status}`);
  return res.json();
}

export async function whoAmI(opts: { fetchImpl?: FetchLike; preferredOrgUuid?: string | null } = {}): Promise<Identity> {
  return parseIdentity(await getJson(opts.fetchImpl ?? defaultFetch, IDENTITY_PATH), opts.preferredOrgUuid);
}

export const usagePath = (orgUuid: string): string => `/api/organizations/${encodeURIComponent(orgUuid)}/usage`;

export async function fetchUsageJson(orgUuid: string, fetchImpl: FetchLike = defaultFetch): Promise<unknown> {
  return getJson(fetchImpl, usagePath(orgUuid));
}

/** A claude.ai API call about `resourceId` answered 403/404 → the resource isn't in this account. */
export function isResourceMiss(apiUrl: string, statusCode: number, resourceId: string): boolean {
  if (statusCode !== 403 && statusCode !== 404) return false;
  let u: URL;
  try {
    u = new URL(apiUrl);
  } catch {
    return false;
  }
  return u.origin === CLAUDE_ORIGIN && u.pathname.startsWith("/api/") && u.pathname.includes(resourceId);
}

export function retargetOrg(apiUrl: string, orgUuid: string): string {
  return apiUrl.replace(/\/organizations\/[^/?#]+/, `/organizations/${orgUuid}`);
}

export const loginUrl = (): string => `${CLAUDE_ORIGIN}${LOGIN_PATH}`;

export function hostMatchesClaude(cookieDomain: string): boolean {
  const d = cookieDomain.replace(/^\./, "");
  return d === CLAUDE_HOST || CLAUDE_HOST.endsWith(`.${d}`);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run tests/unit/claudeApi.test.ts && pnpm typecheck`
Expected: PASS, tsc exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/background/claudeApi.ts tests/fixtures/bootstrap.json tests/unit/claudeApi.test.ts
git commit -m "feat: claude.ai identity, usage and resource-miss helpers"
```

---

### Task 3: cookieJar — snapshot, clear, restore

**Files:**
- Create: `src/background/cookieJar.ts`
- Test: `tests/unit/cookieJar.test.ts`

**Interfaces:**
- Consumes: `CLAUDE_HOST` (Task 1); `PRESERVED_COOKIES`, `SESSION_COOKIE` (Task 2); `StoredCookie`, `SameSite` (Task 1).
- Produces (`src/background/cookieJar.ts`):
  - `toStored(c: chrome.cookies.Cookie): StoredCookie`
  - `cookieUrl(c: Pick<StoredCookie, "domain" | "path" | "secure">): string`
  - `isExpired(c: StoredCookie, nowMs: number): boolean`
  - `hasLiveSession(cookies: StoredCookie[], nowMs: number): boolean`
  - `snapshot(): Promise<StoredCookie[]>` — every claude.ai cookie except preserved ones
  - `clear(): Promise<number>` — removes every non-preserved claude.ai cookie, returns count
  - `restore(cookies: StoredCookie[], nowMs?: number): Promise<number>` — sets non-expired, non-preserved cookies; throws if Chrome refuses one
  - `cookieHeader(cookies: StoredCookie[], nowMs?: number): string`

- [ ] **Step 1: Write the failing test**

`tests/unit/cookieJar.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/cookieJar.test.ts`
Expected: FAIL — `Cannot find module '../../src/background/cookieJar'`.

- [ ] **Step 3: Implement**

`src/background/cookieJar.ts`:

```ts
import { CLAUDE_HOST } from "../shared/env";
import type { SameSite, StoredCookie } from "../shared/types";
import { PRESERVED_COOKIES, SESSION_COOKIE } from "./claudeApi";

// @types/chrome models some string fields as enums; cast through unknown at the boundary.
const asChrome = <T>(v: unknown): T => v as T;

export function toStored(c: chrome.cookies.Cookie): StoredCookie {
  const s: StoredCookie = {
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    secure: c.secure,
    httpOnly: c.httpOnly,
    sameSite: String(c.sameSite ?? "unspecified") as SameSite,
    hostOnly: c.hostOnly,
  };
  if (c.expirationDate !== undefined) s.expirationDate = c.expirationDate;
  return s;
}

export function cookieUrl(c: Pick<StoredCookie, "domain" | "path" | "secure">): string {
  return `${c.secure ? "https" : "http"}://${c.domain.replace(/^\./, "")}${c.path || "/"}`;
}

export function isExpired(c: StoredCookie, nowMs: number): boolean {
  return c.expirationDate !== undefined && c.expirationDate * 1000 <= nowMs;
}

export function hasLiveSession(cookies: StoredCookie[], nowMs: number): boolean {
  return cookies.some((c) => c.name === SESSION_COOKIE && c.value !== "" && !isExpired(c, nowMs));
}

async function claudeCookies(): Promise<chrome.cookies.Cookie[]> {
  const all = await chrome.cookies.getAll({ domain: CLAUDE_HOST });
  return all.filter((c) => !PRESERVED_COOKIES.has(c.name));
}

export async function snapshot(): Promise<StoredCookie[]> {
  return (await claudeCookies()).map(toStored);
}

export async function clear(): Promise<number> {
  const doomed = await claudeCookies();
  await Promise.all(
    doomed.map((c) => chrome.cookies.remove({ url: cookieUrl(c), name: c.name, ...(c.storeId ? { storeId: c.storeId } : {}) })),
  );
  return doomed.length;
}

export async function restore(cookies: StoredCookie[], nowMs: number = Date.now()): Promise<number> {
  let restored = 0;
  for (const c of cookies) {
    if (PRESERVED_COOKIES.has(c.name) || isExpired(c, nowMs)) continue;
    const details: chrome.cookies.SetDetails = {
      url: cookieUrl(c),
      name: c.name,
      value: c.value,
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
      sameSite: asChrome<chrome.cookies.SetDetails["sameSite"]>(c.sameSite),
    };
    if (!c.hostOnly) details.domain = c.domain;
    if (c.expirationDate !== undefined) details.expirationDate = c.expirationDate;
    const set = await chrome.cookies.set(details);
    if (!set) throw new Error(`Chrome refused to restore cookie ${c.name}`);
    restored++;
  }
  return restored;
}

export function cookieHeader(cookies: StoredCookie[], nowMs: number = Date.now()): string {
  return cookies
    .filter((c) => !isExpired(c, nowMs))
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/unit/cookieJar.test.ts && pnpm typecheck`
Expected: PASS, tsc exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/background/cookieJar.ts tests/unit/cookieJar.test.ts
git commit -m "feat: cookie jar snapshot/clear/restore that preserves Cloudflare cookies"
```

---

### Task 4: AccountStore

**Files:**
- Create: `src/background/accounts.ts`
- Test: `tests/unit/accounts.test.ts`

**Interfaces:**
- Consumes: `Account`, `AccountStatus`, `Identity`, `Prefs`, `PublicAccount`, `StoreState`, `StoredCookie`, `ACCOUNT_COLORS` (Task 1).
- Produces (`src/background/accounts.ts`):
  - `STORE_KEY = "cas:state"`, `DEFAULT_PREFS: Prefs` (`{ theme: "system", style: "app", inPageSwitcher: true, badge: true, rescueProbe: false }`)
  - `emptyState(): StoreState`, `migrate(raw: unknown): StoreState`, `class UnsupportedStoreVersion extends Error`
  - `defaultLabel(identity: Pick<Identity, "email">): string`, `pickLabel(identity: Pick<Identity, "email">, taken: Set<string>): string`
  - `toPublic(a: Account): PublicAccount`
  - `class AccountStore(area?: chrome.storage.StorageArea)` with: `load(): Promise<StoreState>`, `update(fn: (s: StoreState) => void): Promise<StoreState>`, `list(): Promise<Account[]>`, `get(id): Promise<Account | undefined>`, `upsert(identity: Identity, cookies: StoredCookie[], now: number): Promise<{ account: Account; isNew: boolean }>`, `setCookies(id, cookies, now): Promise<void>` (also sets status "ok"), `setActive(id: string | null): Promise<void>`, `setStatus(id, status: AccountStatus): Promise<void>`, `rename(id, label): Promise<void>`, `setColor(id, color: number): Promise<void>`, `remove(id): Promise<void>`, `reorder(order: string[]): Promise<void>`, `rememberResource(resourceKey, accountId): Promise<void>`, `resourceAccount(resourceKey): Promise<string | undefined>`, `updatePrefs(patch: Partial<Prefs>): Promise<void>`.

- [ ] **Step 1: Write the failing test**

`tests/unit/accounts.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { AccountStore, STORE_KEY, UnsupportedStoreVersion, defaultLabel, pickLabel, toPublic } from "../../src/background/accounts";
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
    expect(s.prefs).toEqual({ theme: "system", style: "app", inPageSwitcher: true, badge: true, rescueProbe: false });
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
    expect(s.resourceMap).toEqual({ "chat:y": "acct-b" });
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/accounts.test.ts`
Expected: FAIL — `Cannot find module '../../src/background/accounts'`.

- [ ] **Step 3: Implement**

`src/background/accounts.ts`:

```ts
import type { Account, AccountStatus, Identity, Prefs, PublicAccount, StoreState, StoredCookie } from "../shared/types";
import { ACCOUNT_COLORS } from "../shared/types";

export const STORE_KEY = "cas:state";
export const DEFAULT_PREFS: Prefs = { theme: "system", style: "app", inPageSwitcher: true, badge: true, rescueProbe: false };
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
    rescueProbe: Boolean(p.rescueProbe),
  };
}

function firstFreeColor(used: Set<number>): number {
  for (let i = 0; i < ACCOUNT_COLORS.length; i++) if (!used.has(i)) return i;
  return used.size % ACCOUNT_COLORS.length;
}

export class AccountStore {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly area: chrome.storage.StorageArea = chrome.storage.local) {}

  async load(): Promise<StoreState> {
    const got = await this.area.get(STORE_KEY);
    return migrate(got[STORE_KEY]);
  }

  /** Read-modify-write, serialized so concurrent callers never lose each other's writes. */
  update(fn: (s: StoreState) => void): Promise<StoreState> {
    const run = this.chain.then(async () => {
      const s = await this.load();
      fn(s);
      await this.area.set({ [STORE_KEY]: s });
      return s;
    });
    this.chain = run.catch(() => undefined);
    return run;
  }

  async list(): Promise<Account[]> {
    const s = await this.load();
    return s.order.map((id) => s.accounts[id]).filter((a): a is Account => a !== undefined);
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
      for (const [key, owner] of Object.entries(s.resourceMap)) if (owner === id) delete s.resourceMap[key];
    });
  }

  async reorder(order: string[]): Promise<void> {
    await this.update((s) => {
      const known = order.filter((id, i) => s.accounts[id] !== undefined && order.indexOf(id) === i);
      s.order = [...known, ...s.order.filter((id) => !known.includes(id))];
    });
  }

  async rememberResource(resourceKey: string, accountId: string): Promise<void> {
    await this.update((s) => {
      if (s.accounts[accountId]) s.resourceMap[resourceKey] = accountId;
    });
  }

  async resourceAccount(resourceKey: string): Promise<string | undefined> {
    return (await this.load()).resourceMap[resourceKey];
  }

  async updatePrefs(patch: Partial<Prefs>): Promise<void> {
    await this.update((s) => {
      s.prefs = sanitizePrefs({ ...s.prefs, ...patch });
    });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/unit/accounts.test.ts && pnpm typecheck`
Expected: PASS, tsc exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/background/accounts.ts tests/unit/accounts.test.ts
git commit -m "feat: account store with ordering, labels, prefs and resource memory"
```

---

### Task 5: Switcher — verified save, swap, verify, rollback, reload

**Files:**
- Create: `src/background/switcher.ts`
- Create: `tests/unit/harness.ts` (shared by Tasks 5–9)
- Test: `tests/unit/switcher.test.ts`

**Interfaces:**
- Consumes: `snapshot`, `clear`, `restore`, `hasLiveSession` (Task 3); `AccountStore` (Task 4); `AuthError` (Task 2); `CLAUDE_TAB_PATTERN` (Task 1); `Identity`, `StoredCookie` (Task 1).
- Produces (`src/background/switcher.ts`):
  - `interface Jar { snapshot(): Promise<StoredCookie[]>; clear(): Promise<number>; restore(cookies: StoredCookie[], nowMs?: number): Promise<number> }`
  - `interface Api { whoAmI(preferredOrgUuid?: string | null): Promise<Identity> }`
  - `interface TabsPort { reloadClaudeTabs(exceptTabId?: number): Promise<number> }`
  - `interface SwitchDeps { jar: Jar; store: AccountStore; api: Api; tabs: TabsPort; now(): number }`
  - `type SwitchResult = { status: "switched"; accountId: string; reloadedTabs: number } | { status: "signedOut"; accountId: string } | { status: "superseded"; accountId: string } | { status: "error"; accountId: string; message: string }`
  - `reloadClaudeTabs(exceptTabId?: number): Promise<number>` (real chrome.tabs)
  - `saveCurrentSession(deps: SwitchDeps): Promise<{ savedTo: string | null; cookies: StoredCookie[]; isNew: boolean }>` — verifies the browser's current login and upserts it (known or not) so clearing never destroys it
  - `class Switcher(deps: SwitchDeps, onChange?: (switchingTo: string | null, result?: SwitchResult) => void)` with `switchTo(accountId): Promise<SwitchResult>` (last-wins queue), `idle(): Promise<void>`, getter `switchingTo: string | null`
- Produces (`tests/unit/harness.ts`): `IDENTITIES`, `identityForSession(value)`, `sessionCookie(value, extra?)`, `orgCookie(org)`, `interface Harness { fake; store; deps; whoAmI; now: { value: number } }`, `createHarness()`, `saveAccount(h, letter, value?)`, `browserAs(h, value)`, `currentSession(h)`.

- [ ] **Step 1: Write the test harness**

`tests/unit/harness.ts`:

```ts
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
```

- [ ] **Step 2: Write the failing test**

`tests/unit/switcher.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Switcher, reloadClaudeTabs, saveCurrentSession } from "../../src/background/switcher";
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

  it("reloadClaudeTabs can skip one tab", async () => {
    const h = await createHarness();
    h.fake.addTab("https://claude.ai/login");
    h.fake.addTab("https://claude.ai/new");
    expect(await reloadClaudeTabs(1)).toBe(1);
    expect(h.fake.reloads).toEqual([2]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/switcher.test.ts`
Expected: FAIL — `Cannot find module '../../src/background/switcher'`.

- [ ] **Step 4: Implement**

`src/background/switcher.ts`:

```ts
import { CLAUDE_TAB_PATTERN } from "../shared/env";
import type { Identity, StoredCookie } from "../shared/types";
import type { AccountStore } from "./accounts";
import { AuthError } from "./claudeApi";
import { hasLiveSession } from "./cookieJar";

export interface Jar {
  snapshot(): Promise<StoredCookie[]>;
  clear(): Promise<number>;
  restore(cookies: StoredCookie[], nowMs?: number): Promise<number>;
}
export interface Api {
  whoAmI(preferredOrgUuid?: string | null): Promise<Identity>;
}
export interface TabsPort {
  reloadClaudeTabs(exceptTabId?: number): Promise<number>;
}
export interface SwitchDeps {
  jar: Jar;
  store: AccountStore;
  api: Api;
  tabs: TabsPort;
  now(): number;
}

export type SwitchResult =
  | { status: "switched"; accountId: string; reloadedTabs: number }
  | { status: "signedOut"; accountId: string }
  | { status: "superseded"; accountId: string }
  | { status: "error"; accountId: string; message: string };

/** Reloads every claude.ai tab in every window; one failing tab doesn't stop the others. */
export async function reloadClaudeTabs(exceptTabId?: number): Promise<number> {
  const tabs = await chrome.tabs.query({ url: CLAUDE_TAB_PATTERN });
  const ids = tabs.map((t) => t.id).filter((id): id is number => id !== undefined && id !== exceptTabId);
  const results = await Promise.allSettled(ids.map((id) => chrome.tabs.reload(id)));
  return results.filter((r) => r.status === "fulfilled").length;
}

/**
 * Saves the browser's current claude.ai login under the account it really belongs to (checked with
 * claude.ai), adding it if unknown — so clearing cookies afterwards never destroys a login.
 */
export async function saveCurrentSession(deps: SwitchDeps): Promise<{ savedTo: string | null; cookies: StoredCookie[]; isNew: boolean }> {
  const cookies = await deps.jar.snapshot();
  if (!hasLiveSession(cookies, deps.now())) return { savedTo: null, cookies, isNew: false };
  let identity: Identity;
  try {
    identity = await deps.api.whoAmI();
  } catch {
    return { savedTo: null, cookies, isNew: false };
  }
  const fresh = await deps.jar.snapshot(); // claude.ai may have rotated cookies while answering
  const { account, isNew } = await deps.store.upsert(identity, fresh, deps.now());
  return { savedTo: account.id, cookies: fresh, isNew };
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export class Switcher {
  private running: Promise<void> | null = null;
  private pending: { accountId: string; resolve: (r: SwitchResult) => void } | null = null;
  private target: string | null = null;

  constructor(
    private readonly deps: SwitchDeps,
    private readonly onChange: (switchingTo: string | null, result?: SwitchResult) => void = () => {},
  ) {}

  get switchingTo(): string | null {
    return this.target;
  }

  /** Queues a switch. While one runs, only the latest request waits; earlier waiting ones resolve "superseded". */
  switchTo(accountId: string): Promise<SwitchResult> {
    return new Promise((resolve) => {
      if (this.pending) this.pending.resolve({ status: "superseded", accountId: this.pending.accountId });
      this.pending = { accountId, resolve };
      if (!this.running) this.running = this.drain();
    });
  }

  async idle(): Promise<void> {
    while (this.running) await this.running;
  }

  private async drain(): Promise<void> {
    try {
      while (this.pending) {
        const job = this.pending;
        this.pending = null;
        this.target = job.accountId;
        this.onChange(job.accountId);
        let result: SwitchResult;
        try {
          result = await this.run(job.accountId);
        } catch (e) {
          result = { status: "error", accountId: job.accountId, message: message(e) };
        }
        this.target = null;
        this.onChange(null, result);
        job.resolve(result);
      }
    } finally {
      this.running = null;
    }
  }

  private async run(accountId: string): Promise<SwitchResult> {
    const { jar, store, api, tabs, now } = this.deps;
    const target = await store.get(accountId);
    if (!target) return { status: "error", accountId, message: "Unknown account" };

    const previous = await saveCurrentSession(this.deps);
    if (previous.savedTo === accountId) {
      await store.setActive(accountId);
      return { status: "switched", accountId, reloadedTabs: 0 };
    }

    const rollback = async () => {
      await jar.clear();
      await jar.restore(previous.cookies, now());
    };

    try {
      await jar.clear();
      await jar.restore(target.cookies, now());
      let identity: Identity;
      try {
        identity = await api.whoAmI(target.orgUuid);
      } catch (e) {
        await rollback();
        if (e instanceof AuthError) {
          await store.setStatus(accountId, "signedOut");
          return { status: "signedOut", accountId };
        }
        return { status: "error", accountId, message: message(e) };
      }
      if (identity.accountUuid !== accountId) {
        await rollback();
        return { status: "error", accountId, message: `The saved session belongs to ${identity.email}` };
      }
      await store.setCookies(accountId, await jar.snapshot(), now());
      await store.setActive(accountId);
      const reloadedTabs = await tabs.reloadClaudeTabs();
      return { status: "switched", accountId, reloadedTabs };
    } catch (e) {
      await rollback().catch(() => undefined);
      return { status: "error", accountId, message: message(e) };
    }
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run tests/unit/switcher.test.ts && pnpm typecheck`
Expected: PASS, tsc exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/background/switcher.ts tests/unit/harness.ts tests/unit/switcher.test.ts
git commit -m "feat: serialized account switcher with identity check and rollback"
```

---

### Task 6: AddAccountFlow — persisted state machine

**Files:**
- Create: `src/background/addAccount.ts`
- Test: `tests/unit/addAccount.test.ts`

**Interfaces:**
- Consumes: `saveCurrentSession`, `SwitchDeps` (Task 5); `SESSION_COOKIE`, `loginUrl`, `hostMatchesClaude` (Task 2); `hasLiveSession` (Task 3); `AddFlowPublic`, `Identity`, `StoredCookie` (Task 1).
- Produces (`src/background/addAccount.ts`):
  - `ADD_FLOW_KEY = "cas:addFlow"`, `ADD_FLOW_TIMEOUT_MS = 900_000`
  - `type AddFlowInternal` (idle | waitingLogin | saved | mismatch | error — see code)
  - `interface AddDeps extends SwitchDeps { session: chrome.storage.StorageArea; openLoginTab(url: string): Promise<number | null>; closeTab(tabId: number): Promise<void> }`
  - `toPublicAdd(s: AddFlowInternal): AddFlowPublic`
  - `class AddAccountFlow(deps: AddDeps, onChange?: (s: AddFlowPublic) => void)` with `state(): Promise<AddFlowPublic>` (also applies the 15-min timeout and retries completion), `isWaiting(): Promise<boolean>`, `start(targetAccountId?: string | null): Promise<void>`, `onCookieChanged(info: { removed: boolean; cookie: { name: string; domain: string } }): Promise<void>`, `resolveMismatch(addAsNew: boolean): Promise<void>`, `cancel(): Promise<void>`, `dismiss(): Promise<void>`

- [ ] **Step 1: Write the failing test**

`tests/unit/addAccount.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/addAccount.test.ts`
Expected: FAIL — `Cannot find module '../../src/background/addAccount'`.

- [ ] **Step 3: Implement**

`src/background/addAccount.ts`:

```ts
import type { AddFlowPublic, Identity, StoredCookie } from "../shared/types";
import { SESSION_COOKIE, hostMatchesClaude, loginUrl } from "./claudeApi";
import { hasLiveSession } from "./cookieJar";
import { saveCurrentSession, type SwitchDeps } from "./switcher";

export const ADD_FLOW_KEY = "cas:addFlow";
export const ADD_FLOW_TIMEOUT_MS = 15 * 60 * 1000;

type Waiting = {
  phase: "waitingLogin";
  loginTabId: number | null;
  previousCookies: StoredCookie[];
  previousActiveId: string | null;
  targetAccountId: string | null;
  startedAt: number;
};
type Mismatch = {
  phase: "mismatch";
  identity: Identity;
  cookies: StoredCookie[];
  targetAccountId: string;
  previousCookies: StoredCookie[];
  previousActiveId: string | null;
};
export type AddFlowInternal =
  | { phase: "idle" }
  | Waiting
  | { phase: "saved"; accountId: string; isNew: boolean }
  | Mismatch
  | { phase: "error"; message: string };

export interface AddDeps extends SwitchDeps {
  session: chrome.storage.StorageArea;
  openLoginTab(url: string): Promise<number | null>;
  closeTab(tabId: number): Promise<void>;
}

export function toPublicAdd(s: AddFlowInternal): AddFlowPublic {
  const base: AddFlowPublic = { phase: s.phase, targetAccountId: null, savedAccountId: null, isNew: false, mismatchEmail: null, message: null };
  switch (s.phase) {
    case "waitingLogin":
      return { ...base, targetAccountId: s.targetAccountId };
    case "saved":
      return { ...base, savedAccountId: s.accountId, isNew: s.isNew };
    case "mismatch":
      return { ...base, targetAccountId: s.targetAccountId, mismatchEmail: s.identity.email };
    case "error":
      return { ...base, message: s.message };
    default:
      return base;
  }
}

export class AddAccountFlow {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly deps: AddDeps,
    private readonly onChange: (s: AddFlowPublic) => void = () => {},
  ) {}

  state(): Promise<AddFlowPublic> {
    return this.serial(async () => {
      let s = await this.read();
      if (s.phase === "waitingLogin") {
        if (this.deps.now() - s.startedAt > ADD_FLOW_TIMEOUT_MS) await this.cancelNow(s);
        else await this.tryComplete(s);
        s = await this.read();
      }
      return toPublicAdd(s);
    });
  }

  isWaiting(): Promise<boolean> {
    return this.serial(async () => (await this.read()).phase === "waitingLogin");
  }

  start(targetAccountId: string | null = null): Promise<void> {
    return this.serial(async () => {
      const current = await this.read();
      if (current.phase === "waitingLogin" || current.phase === "mismatch") return;
      const previous = await saveCurrentSession(this.deps);
      await this.write({
        phase: "waitingLogin",
        loginTabId: null,
        previousCookies: previous.cookies,
        previousActiveId: previous.savedTo,
        targetAccountId,
        startedAt: this.deps.now(),
      });
      await this.deps.jar.clear();
      const loginTabId = await this.deps.openLoginTab(loginUrl());
      const s = await this.read();
      if (s.phase === "waitingLogin") await this.write({ ...s, loginTabId });
    });
  }

  onCookieChanged(info: { removed: boolean; cookie: { name: string; domain: string } }): Promise<void> {
    if (info.removed || info.cookie.name !== SESSION_COOKIE || !hostMatchesClaude(info.cookie.domain)) return Promise.resolve();
    return this.serial(async () => {
      const s = await this.read();
      if (s.phase === "waitingLogin") await this.tryComplete(s);
    });
  }

  resolveMismatch(addAsNew: boolean): Promise<void> {
    return this.serial(async () => {
      const s = await this.read();
      if (s.phase !== "mismatch") return;
      if (addAsNew) await this.saveAndFinish(s.identity, s.cookies, null);
      else await this.cancelNow(s);
    });
  }

  cancel(): Promise<void> {
    return this.serial(async () => {
      const s = await this.read();
      if (s.phase === "waitingLogin" || s.phase === "mismatch") await this.cancelNow(s);
      else if (s.phase !== "idle") await this.write({ phase: "idle" });
    });
  }

  dismiss(): Promise<void> {
    return this.serial(async () => {
      const s = await this.read();
      if (s.phase === "saved" || s.phase === "error") await this.write({ phase: "idle" });
    });
  }

  // --- internals (call only from inside serial())

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async read(): Promise<AddFlowInternal> {
    const got = await this.deps.session.get(ADD_FLOW_KEY);
    return (got[ADD_FLOW_KEY] as AddFlowInternal | undefined) ?? { phase: "idle" };
  }

  private async write(s: AddFlowInternal): Promise<void> {
    await this.deps.session.set({ [ADD_FLOW_KEY]: s });
    this.onChange(toPublicAdd(s));
  }

  private async tryComplete(s: Waiting): Promise<void> {
    if (!hasLiveSession(await this.deps.jar.snapshot(), this.deps.now())) return;
    let identity: Identity;
    try {
      identity = await this.deps.api.whoAmI();
    } catch {
      return; // not fully signed in yet, or offline: keep waiting (cancel/timeout restore the previous login)
    }
    const fresh = await this.deps.jar.snapshot();
    if (s.targetAccountId && identity.accountUuid !== s.targetAccountId) {
      await this.write({
        phase: "mismatch",
        identity,
        cookies: fresh,
        targetAccountId: s.targetAccountId,
        previousCookies: s.previousCookies,
        previousActiveId: s.previousActiveId,
      });
      return;
    }
    await this.saveAndFinish(identity, fresh, s.loginTabId);
  }

  private async saveAndFinish(identity: Identity, cookies: StoredCookie[], loginTabId: number | null): Promise<void> {
    const { account, isNew } = await this.deps.store.upsert(identity, cookies, this.deps.now());
    await this.deps.store.setActive(account.id);
    await this.write({ phase: "saved", accountId: account.id, isNew });
    await this.deps.tabs.reloadClaudeTabs(loginTabId ?? undefined);
  }

  private async cancelNow(s: { previousCookies: StoredCookie[]; previousActiveId: string | null; loginTabId?: number | null }): Promise<void> {
    await this.deps.jar.clear();
    await this.deps.jar.restore(s.previousCookies, this.deps.now());
    await this.deps.store.setActive(s.previousActiveId);
    if (s.loginTabId !== undefined && s.loginTabId !== null) await this.deps.closeTab(s.loginTabId).catch(() => undefined);
    await this.write({ phase: "idle" });
    await this.deps.tabs.reloadClaudeTabs();
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/unit/addAccount.test.ts && pnpm typecheck`
Expected: PASS, tsc exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/background/addAccount.ts tests/unit/addAccount.test.ts
git commit -m "feat: persisted add-account flow with cancel, timeout and targeted re-sign-in"
```

---

### Task 7: Link rescue — resource keys, miss tracking, Open as, probe

**Files:**
- Create: `src/shared/resourceKey.ts`
- Create: `src/background/rescue.ts`
- Test: `tests/unit/resourceKey.test.ts`, `tests/unit/rescue.test.ts`

**Interfaces:**
- Consumes: `CLAUDE_ORIGIN` (Task 1); `isResourceMiss`, `retargetOrg` (Task 2); `cookieHeader` (Task 3); `AccountStore`, `toPublic` (Task 4); `SwitchResult` (Task 5); `ProbeResult`, `RescueInfo`, `ResourceKind` (Task 1).
- Produces:
  - `src/shared/resourceKey.ts`: `interface ResourceRef { kind: ResourceKind; id: string; key: string }`, `parseResourceUrl(url: string): ResourceRef | null`
  - `src/background/rescue.ts`: `interface Miss { ref: ResourceRef; apiUrl: string; pageUrl: string }`; `class RescueTracker(store: AccountStore)` with `onApiCompleted(d: { tabId: number; url: string; statusCode: number }, pageUrlOf: (tabId: number) => Promise<string | undefined>): Promise<number | null>` (tab to notify, once per resource), `onTabUpdated(tabId: number, change: { status?: string; url?: string }): void`, `onTabRemoved(tabId: number): void`, `miss(tabId: number): Miss | undefined`, `info(tabId: number): Promise<RescueInfo | null>`; `openAs(store: AccountStore, switchTo: (id: string) => Promise<SwitchResult>, resourceKey: string, accountId: string): Promise<SwitchResult>`; `PROBE_RULE_BASE = 9000`; `probe(store: AccountStore, miss: Miss, fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>): Promise<ProbeResult[]>`

- [ ] **Step 1: Write the failing tests**

`tests/unit/resourceKey.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseResourceUrl } from "../../src/shared/resourceKey";

const U = "0b1c2d3e-0000-4000-8000-000000000000";

describe("parseResourceUrl", () => {
  it.each([
    ["https://claude.ai/artifact/7f3c9a?x=1#h", { kind: "artifact", id: "7f3c9a", key: "artifact:7f3c9a" }],
    [`https://claude.ai/code/artifact/${U}`, { kind: "codeArtifact", id: U, key: `codeArtifact:${U}` }],
    [`https://claude.ai/chat/${U}/`, { kind: "chat", id: U, key: `chat:${U}` }],
    [`https://claude.ai/project/${U.toUpperCase()}`, { kind: "project", id: U.toUpperCase(), key: `project:${U.toUpperCase()}` }],
    ["https://claude.ai/public/artifacts/abc", null],
    ["https://claude.ai/new", null],
    ["https://claude.ai/chat/not-a-uuid", null],
    ["https://evil.example/artifact/abc", null],
    ["not a url", null],
  ])("%s", (url, expected) => expect(parseResourceUrl(url)).toEqual(expected));
});
```

`tests/unit/rescue.test.ts`:

```ts
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
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/unit/resourceKey.test.ts tests/unit/rescue.test.ts`
Expected: FAIL — `Cannot find module '../../src/shared/resourceKey'` and `'../../src/background/rescue'`.

- [ ] **Step 3: Implement**

`src/shared/resourceKey.ts`:

```ts
import { CLAUDE_ORIGIN } from "./env";
import type { ResourceKind } from "./types";

export interface ResourceRef {
  kind: ResourceKind;
  id: string;
  key: string; // `${kind}:${id}`
}

const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const ROUTES: { kind: ResourceKind; re: RegExp }[] = [
  { kind: "codeArtifact", re: /^\/code\/artifact\/([A-Za-z0-9_-]+)\/?$/ },
  { kind: "artifact", re: /^\/artifact\/([A-Za-z0-9_-]+)\/?$/ },
  { kind: "chat", re: new RegExp(`^/chat/(${UUID})/?$`) },
  { kind: "project", re: new RegExp(`^/project/(${UUID})/?$`) },
];

/** claude.ai pages that can be "not found" because they belong to another account. */
export function parseResourceUrl(url: string): ResourceRef | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.origin !== CLAUDE_ORIGIN) return null;
  for (const { kind, re } of ROUTES) {
    const m = re.exec(u.pathname);
    if (m?.[1]) return { kind, id: m[1], key: `${kind}:${m[1]}` };
  }
  return null;
}
```

`src/background/rescue.ts`:

```ts
import { parseResourceUrl, type ResourceRef } from "../shared/resourceKey";
import type { ProbeResult, RescueInfo } from "../shared/types";
import { toPublic, type AccountStore } from "./accounts";
import { isResourceMiss, retargetOrg } from "./claudeApi";
import { cookieHeader } from "./cookieJar";
import type { SwitchResult } from "./switcher";

export interface Miss {
  ref: ResourceRef;
  apiUrl: string;
  pageUrl: string;
}

export class RescueTracker {
  private readonly misses = new Map<number, Miss>();

  constructor(private readonly store: AccountStore) {}

  /** Returns the tab to notify (first miss for that resource), else null. */
  async onApiCompleted(
    d: { tabId: number; url: string; statusCode: number },
    pageUrlOf: (tabId: number) => Promise<string | undefined>,
  ): Promise<number | null> {
    if (d.tabId < 0 || (d.statusCode !== 403 && d.statusCode !== 404)) return null;
    const pageUrl = await pageUrlOf(d.tabId);
    const ref = pageUrl ? parseResourceUrl(pageUrl) : null;
    if (!pageUrl || !ref || !isResourceMiss(d.url, d.statusCode, ref.id)) return null;
    const previous = this.misses.get(d.tabId);
    this.misses.set(d.tabId, { ref, apiUrl: d.url, pageUrl });
    return previous?.ref.key === ref.key ? null : d.tabId;
  }

  onTabUpdated(tabId: number, change: { status?: string; url?: string }): void {
    const m = this.misses.get(tabId);
    if (!m) return;
    if (change.status === "loading" || (change.url !== undefined && parseResourceUrl(change.url)?.key !== m.ref.key)) {
      this.misses.delete(tabId);
    }
  }

  onTabRemoved(tabId: number): void {
    this.misses.delete(tabId);
  }

  miss(tabId: number): Miss | undefined {
    return this.misses.get(tabId);
  }

  async info(tabId: number): Promise<RescueInfo | null> {
    const m = this.misses.get(tabId);
    if (!m) return null;
    const s = await this.store.load();
    const remembered = s.resourceMap[m.ref.key] ?? null;
    const candidates = s.order
      .filter((id) => id !== s.activeId)
      .map((id) => s.accounts[id])
      .filter((a) => a !== undefined)
      .map(toPublic)
      .sort((a, b) => Number(b.id === remembered) - Number(a.id === remembered));
    return { resourceKey: m.ref.key, kind: m.ref.kind, currentAccountId: s.activeId, candidates, rememberedAccountId: remembered };
  }
}

export async function openAs(
  store: AccountStore,
  switchTo: (id: string) => Promise<SwitchResult>,
  resourceKey: string,
  accountId: string,
): Promise<SwitchResult> {
  await store.rememberResource(resourceKey, accountId);
  return switchTo(accountId);
}

export const PROBE_RULE_BASE = 9000;

/**
 * Experimental ("Find in my accounts", behind prefs.rescueProbe): asks claude.ai about the resource as each
 * other account, without switching, by injecting that account's Cookie header on one marked request.
 */
export async function probe(
  store: AccountStore,
  miss: Miss,
  fetchImpl: (input: string, init?: RequestInit) => Promise<Response> = (i, init) => fetch(i, init),
): Promise<ProbeResult[]> {
  const s = await store.load();
  const others = s.order.filter((id) => id !== s.activeId).map((id) => s.accounts[id]).filter((a) => a !== undefined);
  const results: ProbeResult[] = [];
  let n = 0;
  for (const account of others) {
    if (account.status === "signedOut") {
      results.push({ accountId: account.id, outcome: "signedOut" });
      continue;
    }
    const ruleId = PROBE_RULE_BASE + n++;
    const marker = `cas_probe=${ruleId}-${Date.now()}`;
    const target = retargetOrg(miss.apiUrl, account.orgUuid);
    const url = `${target}${target.includes("?") ? "&" : "?"}${marker}`;
    const rule = {
      id: ruleId,
      priority: 1,
      action: { type: "modifyHeaders", requestHeaders: [{ header: "cookie", operation: "set", value: cookieHeader(account.cookies) }] },
      condition: { urlFilter: marker, tabIds: [chrome.tabs.TAB_ID_NONE], resourceTypes: ["xmlhttprequest"] },
    } as unknown as chrome.declarativeNetRequest.Rule;
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId], addRules: [rule] });
    try {
      const res = await fetchImpl(url, { credentials: "omit", cache: "no-store" });
      results.push({
        accountId: account.id,
        outcome: res.ok ? "found" : res.status === 401 ? "signedOut" : res.status === 403 || res.status === 404 ? "notFound" : "error",
      });
    } catch {
      results.push({ accountId: account.id, outcome: "error" });
    } finally {
      await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [ruleId] });
    }
  }
  return results;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run tests/unit/resourceKey.test.ts tests/unit/rescue.test.ts && pnpm typecheck`
Expected: PASS, tsc exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/shared/resourceKey.ts src/background/rescue.ts tests/unit/resourceKey.test.ts tests/unit/rescue.test.ts
git commit -m "feat: detect links from other accounts, open as, experimental probe"
```

---

### Task 8: Usage at a glance — parser, snapshots, badge

**Files:**
- Create: `src/shared/usageFormat.ts`
- Create: `src/background/usage.ts`
- Create: `tests/fixtures/usage-limits.json`
- Test: `tests/unit/usage.test.ts`, `tests/unit/usageFormat.test.ts`

**Interfaces:**
- Consumes: `AccountStore` (Task 4); `UsageLimit`, `UsageSnapshot` (Task 1).
- Produces:
  - `src/shared/usageFormat.ts`: `type Level = "ok" | "warn" | "crit"`, `levelOf(percent: number): Level` (≥90 crit, ≥70 warn), `formatAge(ms: number): string` ("just now", "5m ago", "2h ago", "3d ago"), `formatReset(resetsAt: string | null, now: number): string` (< 24 h → "in 2h 30m", else "Mon 06:00" local, null → ""), `resetTitle(limits: UsageLimit[], now: number): string`
  - `src/background/usage.ts`: `USAGE_KEY = "cas:usage"`, `USAGE_ALARM = "cas:usage-refresh"`, `USAGE_PERIOD_MIN = 15`, `USAGE_MAX_AGE_MS = 60_000`, `BADGE_WARN = "#e5a83b"`, `BADGE_CRIT = "#ff6b80"`, `parseUsage(json: unknown): UsageLimit[]`, `badgeFor(snapshot: UsageSnapshot | undefined, enabled: boolean): { text: string; color: string | null }`, `interface UsageDeps { store: AccountStore; area: chrome.storage.StorageArea; fetchUsage(orgUuid: string): Promise<unknown>; now(): number; setBadge(text: string, color: string | null): Promise<void> }`, `class UsageService(deps: UsageDeps)` with `all(): Promise<Record<string, UsageSnapshot>>`, `refreshActive(maxAgeMs?: number): Promise<boolean>` (true if it fetched; serialized), `updateBadge(): Promise<void>`

- [ ] **Step 1: Write the fixture (shape seen from Anthropic's OAuth usage endpoint; the spike confirms claude.ai's)**

`tests/fixtures/usage-limits.json`:

```json
{
  "five_hour": { "utilization": 25.0, "resets_at": "2026-10-01T22:30:00+00:00" },
  "seven_day": { "utilization": 54.0, "resets_at": "2026-10-06T04:00:00+00:00" },
  "seven_day_opus": null,
  "seven_day_omelette": null,
  "limits": [
    { "kind": "session", "group": "session", "percent": 25, "resets_at": "2026-10-01T22:30:00+00:00", "scope": null },
    { "kind": "weekly_all", "group": "weekly", "percent": 54, "resets_at": "2026-10-06T04:00:00+00:00", "scope": null },
    { "kind": "weekly_scoped", "group": "weekly", "percent": 64, "resets_at": "2026-10-06T04:00:00+00:00", "scope": { "model": { "id": null, "display_name": "Fable" }, "surface": null } }
  ]
}
```

- [ ] **Step 2: Write the failing tests**

`tests/unit/usageFormat.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatAge, formatReset, levelOf, resetTitle } from "../../src/shared/usageFormat";

describe("usageFormat", () => {
  it.each([
    [0, "ok"], [69.9, "ok"], [70, "warn"], [89, "warn"], [90, "crit"], [100, "crit"],
  ] as const)("levelOf(%s) = %s", (p, l) => expect(levelOf(p)).toBe(l));

  it.each([
    [10_000, "just now"], [5 * 60_000, "5m ago"], [2 * 3_600_000, "2h ago"], [50 * 3_600_000, "2d ago"],
  ])("formatAge(%s) = %s", (ms, text) => expect(formatAge(ms)).toBe(text));

  it("formats resets", () => {
    const now = Date.parse("2026-10-01T20:00:00Z");
    expect(formatReset("2026-10-01T22:30:00Z", now)).toBe("in 2h 30m");
    expect(formatReset("2026-10-01T20:20:00Z", now)).toBe("in 20m");
    expect(formatReset("2026-10-06T04:00:00Z", now)).toMatch(/^[A-Z][a-z]{2} \d{2}:\d{2}$/);
    expect(formatReset(null, now)).toBe("");
    expect(formatReset("garbage", now)).toBe("");
  });

  it("builds the hover title", () => {
    const now = Date.parse("2026-10-01T20:00:00Z");
    expect(
      resetTitle([{ kind: "session", label: "5h", percent: 25, resetsAt: "2026-10-01T22:30:00Z" }, { kind: "weekly_all", label: "week", percent: 54, resetsAt: null }], now),
    ).toBe("5h resets in 2h 30m");
  });
});
```

`tests/unit/usage.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BADGE_CRIT, BADGE_WARN, USAGE_KEY, UsageService, badgeFor, parseUsage } from "../../src/background/usage";
import fixture from "../fixtures/usage-limits.json";
import { createHarness, saveAccount, type Harness } from "./harness";

describe("parseUsage", () => {
  it("prefers limits[] and labels them 5h / week / model", () => {
    expect(parseUsage(fixture).map((l) => [l.kind, l.label, l.percent])).toEqual([
      ["session", "5h", 25],
      ["weekly_all", "week", 54],
      ["weekly_scoped", "Fable", 64],
    ]);
  });

  it("falls back to five_hour / seven_day / seven_day_<known model>, skipping nulls and codenames", () => {
    const json = {
      seven_day_opus: { utilization: 70, resets_at: null },
      five_hour: { utilization: 12, resets_at: "2026-10-01T22:30:00Z" },
      seven_day: { utilization: 30 },
      seven_day_sonnet: null,
      seven_day_omelette: { utilization: 5 },
      limits: [],
    };
    expect(parseUsage(json).map((l) => `${l.label} ${l.percent}`)).toEqual(["5h 12", "week 30", "Opus 70"]);
  });

  it("skips limits with null percent or unknown kinds without a model, keeps unknown kinds with one", () => {
    const json = {
      limits: [
        { kind: "session", percent: null },
        { kind: "mystery", percent: 40 },
        { kind: "weekly_surface", percent: 41, scope: { model: { display_name: "Haiku" } } },
        { kind: "weekly_all", percent: 150 },
      ],
    };
    expect(parseUsage(json)).toEqual([
      { kind: "weekly_all", label: "week", percent: 100, resetsAt: null },
      { kind: "weekly_surface", label: "Haiku", percent: 41, resetsAt: null },
    ]);
  });

  it.each([null, undefined, "x", 42, {}, { limits: "nope" }])("returns [] for %j", (json) => expect(parseUsage(json)).toEqual([]));
});

describe("badgeFor", () => {
  const snap = (...p: number[]) => ({ fetchedAt: 0, limits: p.map((percent) => ({ kind: "x", label: "x", percent, resetsAt: null })) });
  it.each([
    [snap(10, 69), true, { text: "", color: null }],
    [snap(10, 70), true, { text: "70%", color: BADGE_WARN }],
    [snap(91.6, 20), true, { text: "92%", color: BADGE_CRIT }],
    [snap(95), false, { text: "", color: null }],
    [undefined, true, { text: "", color: null }],
  ])("%j / %s", (s, enabled, expected) => expect(badgeFor(s, enabled)).toEqual(expected));
});

describe("UsageService", () => {
  let h: Harness;
  let fetchUsage: ReturnType<typeof vi.fn<(org: string) => Promise<unknown>>>;
  let setBadge: ReturnType<typeof vi.fn<(text: string, color: string | null) => Promise<void>>>;
  let usage: UsageService;

  beforeEach(async () => {
    h = await createHarness();
    await saveAccount(h, "A");
    await saveAccount(h, "B");
    await h.store.setActive("acct-a");
    fetchUsage = vi.fn<(org: string) => Promise<unknown>>(async () => fixture);
    setBadge = vi.fn<(text: string, color: string | null) => Promise<void>>(async () => undefined);
    usage = new UsageService({ store: h.store, area: h.fake.chrome.storage.local, fetchUsage, now: () => h.now.value, setBadge });
  });

  it("fetches the active org and stores a snapshot", async () => {
    expect(await usage.refreshActive()).toBe(true);
    expect(fetchUsage).toHaveBeenCalledWith("org-a");
    const all = await usage.all();
    expect(all["acct-a"]).toMatchObject({ fetchedAt: h.now.value });
    expect(all["acct-a"]!.limits).toHaveLength(3);
    expect(setBadge).toHaveBeenLastCalledWith("", null);
  });

  it("skips the fetch while the snapshot is fresh", async () => {
    await usage.refreshActive();
    h.now.value += 30_000;
    expect(await usage.refreshActive(60_000)).toBe(false);
    h.now.value += 31_000;
    expect(await usage.refreshActive(60_000)).toBe(true);
    expect(fetchUsage).toHaveBeenCalledTimes(2);
  });

  it("keeps the last snapshot of an account after switching away", async () => {
    await usage.refreshActive();
    await h.store.setActive("acct-b");
    fetchUsage.mockResolvedValueOnce({ five_hour: { utilization: 91 } });
    await usage.refreshActive();
    const all = await usage.all();
    expect(Object.keys(all).sort()).toEqual(["acct-a", "acct-b"]);
    expect(setBadge).toHaveBeenLastCalledWith("91%", BADGE_CRIT);
  });

  it("keeps the old snapshot when the fetch fails and skips signed-out accounts", async () => {
    await usage.refreshActive();
    fetchUsage.mockRejectedValueOnce(new Error("offline"));
    h.now.value += 120_000;
    expect(await usage.refreshActive()).toBe(false);
    expect((await usage.all())["acct-a"]).toBeDefined();
    await h.store.setStatus("acct-a", "signedOut");
    expect(await usage.refreshActive()).toBe(false);
  });

  it("prunes snapshots of removed accounts and respects the badge pref", async () => {
    await h.fake.api.storage.local.set({ [USAGE_KEY]: { ghost: { limits: [], fetchedAt: 1 } } });
    await h.store.updatePrefs({ badge: false });
    fetchUsage.mockResolvedValueOnce({ five_hour: { utilization: 95 } });
    await usage.refreshActive();
    expect(Object.keys(await usage.all())).toEqual(["acct-a"]);
    expect(setBadge).toHaveBeenLastCalledWith("", null);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm vitest run tests/unit/usage.test.ts tests/unit/usageFormat.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement**

`src/shared/usageFormat.ts`:

```ts
import type { UsageLimit } from "./types";

export type Level = "ok" | "warn" | "crit";

export function levelOf(percent: number): Level {
  if (percent >= 90) return "crit";
  if (percent >= 70) return "warn";
  return "ok";
}

export function formatAge(ms: number): string {
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const pad = (n: number) => String(n).padStart(2, "0");

export function formatReset(resetsAt: string | null, now: number): string {
  if (!resetsAt) return "";
  const t = Date.parse(resetsAt);
  if (Number.isNaN(t)) return "";
  const diff = t - now;
  if (diff < 24 * 3_600_000) {
    const total = Math.max(0, Math.round(diff / 60_000));
    const h = Math.floor(total / 60);
    const m = total % 60;
    return h > 0 ? `in ${h}h ${m}m` : `in ${m}m`;
  }
  const d = new Date(t);
  return `${DAYS[d.getDay()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function resetTitle(limits: UsageLimit[], now: number): string {
  return limits
    .map((l) => ({ l, when: formatReset(l.resetsAt, now) }))
    .filter((x) => x.when)
    .map((x) => `${x.l.label} resets ${x.when}`)
    .join(" · ");
}
```

`src/background/usage.ts`:

```ts
import type { UsageLimit, UsageSnapshot } from "../shared/types";
import { levelOf } from "../shared/usageFormat";
import type { AccountStore } from "./accounts";

export const USAGE_KEY = "cas:usage";
export const USAGE_ALARM = "cas:usage-refresh";
export const USAGE_PERIOD_MIN = 15;
export const USAGE_MAX_AGE_MS = 60_000;
export const BADGE_WARN = "#e5a83b";
export const BADGE_CRIT = "#ff6b80";

const KNOWN_MODELS = ["fable", "opus", "sonnet", "haiku"];
const RANK: Record<string, number> = { session: 0, weekly_all: 1 };

const pct = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const obj = (v: unknown): Record<string, unknown> | null => (v !== null && typeof v === "object" ? (v as Record<string, unknown>) : null);
const sortLimits = (l: UsageLimit[]) => [...l].sort((a, b) => (RANK[a.kind] ?? 2) - (RANK[b.kind] ?? 2));

/** Tolerant: `limits[]` when present and usable, else five_hour / seven_day / seven_day_<known model>. */
export function parseUsage(json: unknown): UsageLimit[] {
  const o = obj(json);
  if (!o) return [];
  if (Array.isArray(o.limits)) {
    const out: UsageLimit[] = [];
    for (const raw of o.limits) {
      const r = obj(raw);
      const percent = pct(r?.percent);
      if (!r || percent === null) continue;
      const kind = str(r.kind) ?? "unknown";
      const model = str(obj(obj(r.scope)?.model)?.display_name);
      const label = kind === "session" ? "5h" : kind === "weekly_all" ? "week" : model;
      if (!label) continue;
      out.push({ kind, label, percent, resetsAt: str(r.resets_at) });
    }
    if (out.length > 0) return sortLimits(out);
  }
  const out: UsageLimit[] = [];
  const window = (key: string, kind: string, label: string) => {
    const w = obj(o[key]);
    const percent = pct(w?.utilization);
    if (w && percent !== null) out.push({ kind, label, percent, resetsAt: str(w.resets_at) });
  };
  window("five_hour", "session", "5h");
  window("seven_day", "weekly_all", "week");
  for (const m of KNOWN_MODELS) window(`seven_day_${m}`, "weekly_scoped", m.charAt(0).toUpperCase() + m.slice(1));
  return sortLimits(out);
}

export function badgeFor(snapshot: UsageSnapshot | undefined, enabled: boolean): { text: string; color: string | null } {
  if (!enabled || !snapshot || snapshot.limits.length === 0) return { text: "", color: null };
  const max = Math.max(...snapshot.limits.map((l) => l.percent));
  const level = levelOf(max);
  if (level === "ok") return { text: "", color: null };
  return { text: `${Math.round(max)}%`, color: level === "crit" ? BADGE_CRIT : BADGE_WARN };
}

export interface UsageDeps {
  store: AccountStore;
  area: chrome.storage.StorageArea;
  fetchUsage(orgUuid: string): Promise<unknown>;
  now(): number;
  setBadge(text: string, color: string | null): Promise<void>;
}

export class UsageService {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: UsageDeps) {}

  async all(): Promise<Record<string, UsageSnapshot>> {
    const got = await this.deps.area.get(USAGE_KEY);
    return (got[USAGE_KEY] as Record<string, UsageSnapshot> | undefined) ?? {};
  }

  /** Fetches the active account's usage unless its snapshot is younger than `maxAgeMs`. Serialized. */
  refreshActive(maxAgeMs = 0): Promise<boolean> {
    const run = this.chain.then(() => this.doRefresh(maxAgeMs));
    this.chain = run.catch(() => undefined);
    return run;
  }

  async updateBadge(): Promise<void> {
    const s = await this.deps.store.load();
    const all = await this.all();
    const b = badgeFor(s.activeId ? all[s.activeId] : undefined, s.prefs.badge);
    await this.deps.setBadge(b.text, b.color);
  }

  private async doRefresh(maxAgeMs: number): Promise<boolean> {
    const s = await this.deps.store.load();
    const active = s.activeId ? s.accounts[s.activeId] : undefined;
    if (!active || active.status !== "ok" || !active.orgUuid) return false;
    const all = await this.all();
    const prev = all[active.id];
    if (prev && this.deps.now() - prev.fetchedAt < maxAgeMs) return false;
    let limits: UsageLimit[];
    try {
      limits = parseUsage(await this.deps.fetchUsage(active.orgUuid));
    } catch {
      return false;
    }
    const next: Record<string, UsageSnapshot> = {};
    for (const id of s.order) {
      const snap = all[id];
      if (snap) next[id] = snap;
    }
    next[active.id] = { limits, fetchedAt: this.deps.now() };
    await this.deps.area.set({ [USAGE_KEY]: next });
    await this.updateBadge();
    return true;
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run tests/unit/usage.test.ts tests/unit/usageFormat.test.ts && pnpm typecheck`
Expected: PASS, tsc exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/shared/usageFormat.ts src/background/usage.ts tests/fixtures/usage-limits.json tests/unit/usage.test.ts tests/unit/usageFormat.test.ts
git commit -m "feat: per-account usage snapshots and toolbar badge"
```

---

### Task 9: Message router and background wiring

**Files:**
- Create: `src/background/router.ts`
- Modify (replace stub): `src/background/index.ts`
- Test: `tests/unit/router.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–8: `AccountStore`, `toPublic`, `Switcher`, `SwitchResult`, `reloadClaudeTabs`, `AddAccountFlow`, `RescueTracker`, `Miss`, `openAs`, `probe`, `UsageService`, `USAGE_*`, `whoAmI`, `fetchUsageJson`, cookieJar functions; `Request`, `Push`, `Reply` (Task 1); `CLAUDE_TAB_PATTERN`, `CLAUDE_API_PATTERN` (Task 1).
- Produces (`src/background/router.ts`):
  - `interface RouterDeps { store: AccountStore; switcher: Switcher; addFlow: AddAccountFlow; rescue: RescueTracker; usage: Pick<UsageService, "all" | "refreshActive" | "updateBadge">; probe(miss: Miss): Promise<ProbeResult[]>; broadcast(): Promise<void>; lastSwitch(): UiState["lastSwitch"]; lastError(): string | null }`
  - `buildUiState(deps: RouterDeps): Promise<UiState>` (no cookies; usage filtered to listed accounts)
  - `isRequest(msg: unknown): msg is Request`
  - `createRouter(deps: RouterDeps): (req: Request, sender: { tab?: { id?: number } }) => Promise<Reply>`
  - `broadcastPush(push: Push): Promise<void>` (never throws when the popup is closed)
- Behaviour: `switch` and `rescue:openAs` return immediately and run in the background; `getState` triggers a non-blocking usage refresh when older than 60 s; mutations broadcast.

- [ ] **Step 1: Write the failing test**

`tests/unit/router.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AddAccountFlow } from "../../src/background/addAccount";
import { RescueTracker } from "../../src/background/rescue";
import { broadcastPush, buildUiState, createRouter, isRequest, type RouterDeps } from "../../src/background/router";
import { Switcher } from "../../src/background/switcher";
import type { UiState } from "../../src/shared/types";
import { browserAs, createHarness, currentSession, saveAccount, type Harness } from "./harness";

describe("router", () => {
  let h: Harness;
  let deps: RouterDeps;
  let handle: ReturnType<typeof createRouter>;
  let broadcast: ReturnType<typeof vi.fn<() => Promise<void>>>;
  let refreshActive: ReturnType<typeof vi.fn<(maxAgeMs?: number) => Promise<boolean>>>;

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
    expect(refreshActive).toHaveBeenCalledWith(60_000);
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
    await handle({ type: "rescue:openAs", accountId: "acct-b", resourceKey: "artifact:7f3c" }, { tab: { id: 1 } });
    await vi.waitFor(async () => expect(await h.store.resourceAccount("artifact:7f3c")).toBe("acct-b"));
    await vi.waitFor(async () => expect((await h.store.load()).activeId).toBe("acct-b"));
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/router.test.ts`
Expected: FAIL — `Cannot find module '../../src/background/router'`.

- [ ] **Step 3: Implement the router**

`src/background/router.ts`:

```ts
import { CLAUDE_TAB_PATTERN } from "../shared/env";
import type { Push, Reply, Request } from "../shared/messages";
import type { ProbeResult, UiState, UsageSnapshot } from "../shared/types";
import { toPublic, type AccountStore } from "./accounts";
import type { AddAccountFlow } from "./addAccount";
import { openAs, type Miss, type RescueTracker } from "./rescue";
import type { Switcher } from "./switcher";
import { USAGE_MAX_AGE_MS, type UsageService } from "./usage";

export interface RouterDeps {
  store: AccountStore;
  switcher: Switcher;
  addFlow: AddAccountFlow;
  rescue: RescueTracker;
  usage: Pick<UsageService, "all" | "refreshActive" | "updateBadge">;
  probe(miss: Miss): Promise<ProbeResult[]>;
  broadcast(): Promise<void>;
  lastSwitch(): UiState["lastSwitch"];
  lastError(): string | null;
}

const REQUEST_TYPES = new Set<string>([
  "getState", "switch", "addAccount:start", "addAccount:cancel", "addAccount:resolveMismatch", "addAccount:dismiss",
  "account:update", "account:remove", "account:reorder", "prefs:update", "rescue:get", "rescue:openAs", "rescue:probe",
]);

export function isRequest(msg: unknown): msg is Request {
  return typeof msg === "object" && msg !== null && REQUEST_TYPES.has(String((msg as { type?: unknown }).type));
}

export async function buildUiState(deps: RouterDeps): Promise<UiState> {
  const s = await deps.store.load();
  const accounts = s.order.map((id) => s.accounts[id]).filter((a) => a !== undefined).map(toPublic);
  const all = await deps.usage.all();
  const usage: Record<string, UsageSnapshot> = {};
  for (const a of accounts) {
    const snap = all[a.id];
    if (snap) usage[a.id] = snap;
  }
  return {
    accounts,
    activeId: s.activeId,
    prefs: s.prefs,
    switchingTo: deps.switcher.switchingTo,
    lastSwitch: deps.lastSwitch(),
    add: await deps.addFlow.state(),
    usage,
    error: deps.lastError(),
  };
}

export async function broadcastPush(push: Push): Promise<void> {
  await chrome.runtime.sendMessage(push).catch(() => undefined); // no popup open → nobody listens
  const tabs = await chrome.tabs.query({ url: CLAUDE_TAB_PATTERN });
  await Promise.allSettled(tabs.map((t) => (t.id === undefined ? Promise.resolve() : chrome.tabs.sendMessage(t.id, push))));
}

export function createRouter(deps: RouterDeps) {
  const ok = <T>(data: T): Reply<T> => ({ ok: true, data });
  const fail = (error: string): Reply<never> => ({ ok: false, error });
  const mutate = async (fn: () => Promise<unknown>): Promise<Reply<null>> => {
    await fn();
    await deps.broadcast();
    return ok(null);
  };

  return async function handle(req: Request, sender: { tab?: { id?: number } }): Promise<Reply> {
    try {
      switch (req.type) {
        case "getState": {
          void deps.usage
            .refreshActive(USAGE_MAX_AGE_MS)
            .then((fetched) => (fetched ? deps.broadcast() : undefined))
            .catch(() => undefined);
          return ok(await buildUiState(deps));
        }
        case "switch":
          if (await deps.addFlow.isWaiting()) await deps.addFlow.cancel();
          void deps.switcher.switchTo(req.accountId); // the background owns the flow; UI follows broadcasts
          return ok(null);
        case "addAccount:start":
          return mutate(() => deps.addFlow.start(req.targetAccountId ?? null));
        case "addAccount:cancel":
          return mutate(() => deps.addFlow.cancel());
        case "addAccount:resolveMismatch":
          return mutate(() => deps.addFlow.resolveMismatch(req.addAsNew));
        case "addAccount:dismiss":
          return mutate(() => deps.addFlow.dismiss());
        case "account:update":
          return mutate(async () => {
            if (req.patch.label !== undefined) await deps.store.rename(req.accountId, req.patch.label);
            if (req.patch.color !== undefined) await deps.store.setColor(req.accountId, req.patch.color);
          });
        case "account:remove":
          return mutate(() => deps.store.remove(req.accountId));
        case "account:reorder":
          return mutate(() => deps.store.reorder(req.order));
        case "prefs:update":
          return mutate(async () => {
            await deps.store.updatePrefs(req.patch);
            await deps.usage.updateBadge();
          });
        case "rescue:get": {
          const tabId = sender.tab?.id;
          return ok(tabId === undefined ? null : await deps.rescue.info(tabId));
        }
        case "rescue:openAs":
          void openAs(deps.store, (id) => deps.switcher.switchTo(id), req.resourceKey, req.accountId);
          return ok(null);
        case "rescue:probe": {
          const tabId = sender.tab?.id;
          const miss = tabId === undefined ? undefined : deps.rescue.miss(tabId);
          if (!miss || miss.ref.key !== req.resourceKey) return fail("Nothing to look for on this tab");
          if (!(await deps.store.load()).prefs.rescueProbe) return fail("Find in my accounts is turned off");
          return ok(await deps.probe(miss));
        }
        default:
          return fail(`Unknown request ${(req as { type: string }).type}`);
      }
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  };
}
```

- [ ] **Step 4: Wire the service worker**

`src/background/index.ts` (replaces the stub):

```ts
import { CLAUDE_API_PATTERN } from "../shared/env";
import type { Push } from "../shared/messages";
import type { UiState } from "../shared/types";
import { AccountStore } from "./accounts";
import { AddAccountFlow } from "./addAccount";
import { fetchUsageJson, whoAmI } from "./claudeApi";
import * as jar from "./cookieJar";
import { RescueTracker, probe } from "./rescue";
import { broadcastPush, buildUiState, createRouter, isRequest, type RouterDeps } from "./router";
import { Switcher, reloadClaudeTabs, type SwitchDeps } from "./switcher";
import { USAGE_ALARM, USAGE_PERIOD_MIN, UsageService } from "./usage";

const store = new AccountStore(chrome.storage.local);
const now = () => Date.now();
let lastSwitch: UiState["lastSwitch"] = null;
let lastError: string | null = null;

const switchDeps: SwitchDeps = {
  jar,
  store,
  api: { whoAmI: (org) => whoAmI({ preferredOrgUuid: org ?? null }) },
  tabs: { reloadClaudeTabs },
  now,
};

const usage = new UsageService({
  store,
  area: chrome.storage.local,
  fetchUsage: (org) => fetchUsageJson(org),
  now,
  setBadge: async (text, color) => {
    await chrome.action.setBadgeText({ text });
    if (color) await chrome.action.setBadgeBackgroundColor({ color });
  },
});

const refreshUsageAndBroadcast = () => void usage.refreshActive(0).then(() => broadcast(), () => broadcast());

const switcher = new Switcher(switchDeps, (_switchingTo, result) => {
  if (result?.status === "switched") {
    lastSwitch = { accountId: result.accountId, reloadedTabs: result.reloadedTabs, at: now() };
    lastError = null;
    refreshUsageAndBroadcast();
    return;
  }
  if (result?.status === "signedOut") lastError = "That account is signed out — sign in again.";
  if (result?.status === "error") lastError = result.message;
  void broadcast();
});

const addFlow = new AddAccountFlow(
  {
    ...switchDeps,
    session: chrome.storage.session,
    openLoginTab: async (url) => (await chrome.tabs.create({ url, active: true })).id ?? null,
    closeTab: (id) => chrome.tabs.remove(id),
  },
  (s) => {
    if (s.phase === "saved") refreshUsageAndBroadcast();
    else void broadcast();
  },
);

const rescue = new RescueTracker(store);

const routerDeps: RouterDeps = {
  store,
  switcher,
  addFlow,
  rescue,
  usage,
  probe: (miss) => probe(store, miss),
  broadcast,
  lastSwitch: () => lastSwitch,
  lastError: () => lastError,
};
const handle = createRouter(routerDeps);

async function broadcast(): Promise<void> {
  await broadcastPush({ type: "state", state: await buildUiState(routerDeps) });
}

// Listeners are registered synchronously at top level so Chrome can wake the worker for them.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!isRequest(msg)) return false;
  void handle(msg, sender).then(sendResponse);
  return true;
});

chrome.cookies.onChanged.addListener((info) => {
  void addFlow.onCookieChanged(info);
});

chrome.webRequest.onCompleted.addListener(
  (d) => {
    void rescue
      .onApiCompleted(d, async (tabId) => (await chrome.tabs.get(tabId).catch(() => undefined))?.url)
      .then(async (tabId) => {
        if (tabId === null) return;
        const info = await rescue.info(tabId);
        if (!info) return;
        const push: Push = { type: "rescue:show", rescue: info };
        await chrome.tabs.sendMessage(tabId, push).catch(() => undefined); // content script may not be ready yet; it asks on load
      });
  },
  { urls: [CLAUDE_API_PATTERN], types: ["xmlhttprequest"] } as unknown as chrome.webRequest.RequestFilter,
);

chrome.tabs.onUpdated.addListener((tabId, change) => rescue.onTabUpdated(tabId, change));
chrome.tabs.onRemoved.addListener((tabId) => rescue.onTabRemoved(tabId));

void chrome.alarms.get(USAGE_ALARM).then((alarm) => {
  if (!alarm) void chrome.alarms.create(USAGE_ALARM, { periodInMinutes: USAGE_PERIOD_MIN });
});
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === USAGE_ALARM) void usage.refreshActive(0).then((fetched) => (fetched ? broadcast() : undefined));
});
```

- [ ] **Step 5: Run tests, typecheck and build**

Run: `pnpm vitest run && pnpm typecheck && pnpm build`
Expected: all unit tests PASS (including `build.test.ts`, whose background.js still contains `https://claude.ai`), tsc exit 0, `dist/` written.

- [ ] **Step 6: Commit**

```bash
git add src/background/router.ts src/background/index.ts tests/unit/router.test.ts
git commit -m "feat: background message router and service worker wiring"
```

---

### Task 10: Popup UI

**Files:**
- Create: `src/shared/html.ts`
- Create: `src/popup/view.ts`, `src/popup/popup.ts`
- Modify (replace stubs): `src/popup/main.ts`, `src/popup/popup.css`
- Test: `tests/unit/popup.test.ts`

**Interfaces:**
- Consumes: `UiState`, `PublicAccount`, `Prefs`, `ACCOUNT_COLORS` (Task 1); `Request`, `Push`, `sendToBackground` (Task 1); `levelOf`, `formatAge`, `resetTitle` (Task 8).
- Produces:
  - `src/shared/html.ts`: `esc(s: string): string`, `avatarHtml(label: string, color: number): string`
  - `src/popup/view.ts`: `type Screen = "list" | "manage" | "addIntro"`, `interface ViewState { screen: Screen; confirmRemoveId: string | null }`, `usageLine(a: PublicAccount, s: UiState, now: number): string`, `render(s: UiState, v: ViewState, now: number): string`
  - `src/popup/popup.ts`: `type Send = (req: Request) => Promise<unknown>`, `applyPrefs(doc: Document, s: UiState): void`, `mount(root: HTMLElement, send: Send, initial: UiState, now?: () => number): { update(next: UiState): void; current(): UiState; view: ViewState }`
- Visual: match scene 1 (list) and scene 4 (add flow) of the prototype; usage line per row (`5h 25% · week 54% · Fable 64%`, inactive rows muted "as of 2h ago", reset times in `title`).

- [ ] **Step 1: Write the failing test**

`tests/unit/popup.test.ts`:

```ts
// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyPrefs, mount } from "../../src/popup/popup";
import type { PublicAccount, UiState } from "../../src/shared/types";

const NOW = Date.parse("2026-10-01T20:00:00Z");
const acct = (id: string, label: string, extra: Partial<PublicAccount> = {}): PublicAccount => ({
  id, email: `${label.toLowerCase()}@example.com`, name: label, label, color: 0, plan: "Pro", orgUuid: `org-${id}`, savedAt: 0, status: "ok", ...extra,
});
const ui = (over: Partial<UiState> = {}): UiState => ({
  accounts: [acct("a", "Acme", { plan: "Max 20x" }), acct("b", "Personal", { color: 1 }), acct("c", "Lab", { status: "signedOut" })],
  activeId: "a",
  prefs: { theme: "system", style: "app", inPageSwitcher: true, badge: true, rescueProbe: false },
  switchingTo: null,
  lastSwitch: null,
  add: { phase: "idle", targetAccountId: null, savedAccountId: null, isNew: false, mismatchEmail: null, message: null },
  usage: {
    a: { fetchedAt: NOW - 10_000, limits: [
      { kind: "session", label: "5h", percent: 25, resetsAt: "2026-10-01T22:30:00Z" },
      { kind: "weekly_all", label: "week", percent: 54, resetsAt: "2026-10-06T04:00:00Z" },
      { kind: "weekly_scoped", label: "Fable", percent: 64, resetsAt: "2026-10-06T04:00:00Z" },
    ] },
    b: { fetchedAt: NOW - 2 * 3_600_000, limits: [{ kind: "session", label: "5h", percent: 92, resetsAt: null }] },
  },
  error: null,
  ...over,
});

describe("popup", () => {
  let root: HTMLElement;
  let send: ReturnType<typeof vi.fn<(req: unknown) => Promise<unknown>>>;
  const click = (sel: string) => root.querySelector<HTMLElement>(sel)!.click();

  beforeEach(() => {
    document.body.innerHTML = `<div id="app"></div>`;
    root = document.getElementById("app")!;
    send = vi.fn<(req: unknown) => Promise<unknown>>(async () => null);
  });

  it("lists accounts in order with ✓ on the active one and ⌥N hints", () => {
    mount(root, send, ui(), () => NOW);
    const rows = [...root.querySelectorAll(".row")];
    expect(rows.map((r) => r.querySelector(".label")!.textContent)).toEqual(["Acme", "Personal", "Lab"]);
    expect(rows[0]!.querySelector(".check")).not.toBeNull();
    expect(rows[1]!.querySelector(".kbd")!.textContent).toBe("⌥2");
    expect(rows[2]!.textContent).toContain("signed out — sign in again");
    expect(root.textContent).toContain("3 accounts");
  });

  it("shows a usage line per row: live for the active one, 'as of' for others", () => {
    mount(root, send, ui(), () => NOW);
    const [a, b] = [...root.querySelectorAll(".row .usage")] as HTMLElement[];
    expect(a!.textContent!.replace(/\s+/g, " ")).toContain("5h 25% · week 54% · Fable 64%");
    expect(a!.title).toMatch(/^5h resets in 2h 30m · week resets [A-Z][a-z]{2} \d{2}:\d{2} · Fable resets /);
    expect(a!.classList.contains("stale")).toBe(false);
    expect(b!.textContent).toContain("as of 2h ago");
    expect(b!.querySelector(".u.crit")).not.toBeNull();
  });

  it("switches on click; a signed-out row starts a targeted sign-in", () => {
    mount(root, send, ui(), () => NOW);
    click('[data-action="switch"][data-id="b"]');
    click('[data-action="signin"][data-id="c"]');
    expect(send).toHaveBeenNthCalledWith(1, { type: "switch", accountId: "b" });
    expect(send).toHaveBeenNthCalledWith(2, { type: "addAccount:start", targetAccountId: "c" });
  });

  it("shows switching and recent-switch status", () => {
    const app = mount(root, send, ui({ switchingTo: "b" }), () => NOW);
    expect(root.querySelector(".status")!.textContent).toContain("Switching to Personal");
    app.update(ui({ lastSwitch: { accountId: "b", reloadedTabs: 2, at: NOW - 1000 } }));
    expect(root.querySelector(".status")!.textContent).toContain("Reloaded 2 claude.ai tabs");
    app.update(ui({ lastSwitch: { accountId: "b", reloadedTabs: 2, at: NOW - 60_000 } }));
    expect(root.querySelector(".status")).toBeNull();
  });

  it("walks the add flow: intro → start → waiting → saved → done", async () => {
    const app = mount(root, send, ui(), () => NOW);
    click('[data-action="addIntro"]');
    expect(root.textContent).toContain("Open claude.ai login");
    click('[data-action="addStart"]');
    expect(send).toHaveBeenLastCalledWith({ type: "addAccount:start" });
    app.update(ui({ add: { phase: "waitingLogin", targetAccountId: null, savedAccountId: null, isNew: false, mismatchEmail: null, message: null } }));
    click('[data-action="addCancel"]');
    expect(send).toHaveBeenLastCalledWith({ type: "addAccount:cancel" });
    app.update(ui({ add: { phase: "saved", targetAccountId: null, savedAccountId: "b", isNew: true, mismatchEmail: null, message: null } }));
    expect(root.textContent).toContain("Saved personal@example.com · Pro");
    const input = root.querySelector<HTMLInputElement>("#label")!;
    input.value = "Home";
    app.update(ui({ add: { phase: "saved", targetAccountId: null, savedAccountId: "b", isNew: true, mismatchEmail: null, message: null } }));
    expect(root.querySelector<HTMLInputElement>("#label")!.value).toBe("Home"); // survives a broadcast
    click('[data-action="addDone"]');
    await vi.waitFor(() => expect(send).toHaveBeenLastCalledWith({ type: "addAccount:dismiss" }));
    expect(send).toHaveBeenCalledWith({ type: "account:update", accountId: "b", patch: { label: "Home" } });
  });

  it("offers both choices on a mismatch", () => {
    mount(root, send, ui({ add: { phase: "mismatch", targetAccountId: "c", savedAccountId: null, isNew: false, mismatchEmail: "x@y.example", message: null } }), () => NOW);
    expect(root.textContent).toContain("You signed in as x@y.example, not lab@example.com");
    click('[data-action="mismatchAdd"]');
    click('[data-action="mismatchCancel"]');
    expect(send).toHaveBeenNthCalledWith(1, { type: "addAccount:resolveMismatch", addAsNew: true });
    expect(send).toHaveBeenNthCalledWith(2, { type: "addAccount:resolveMismatch", addAsNew: false });
  });

  it("manage: rename, reorder, colour, two-step remove (not the active one), prefs", () => {
    mount(root, send, ui(), () => NOW);
    click('[data-action="manage"]');
    const rename = root.querySelector<HTMLInputElement>('[data-action="rename"][data-id="b"]')!;
    rename.value = "Home";
    rename.dispatchEvent(new Event("change", { bubbles: true }));
    click('[data-action="up"][data-id="b"]');
    click('[data-action="color"][data-id="b"]');
    expect(root.querySelector<HTMLButtonElement>('[data-action="remove"][data-id="a"]')!.disabled).toBe(true);
    click('[data-action="remove"][data-id="b"]');
    expect(root.querySelector('[data-action="remove"][data-id="b"]')!.textContent).toBe("Confirm");
    click('[data-action="remove"][data-id="b"]');
    click('[data-action="pref"][data-pref="style"][data-value="cli"]');
    click('[data-action="toggle"][data-pref="badge"]');
    expect(send.mock.calls.map((c) => c[0])).toEqual([
      { type: "account:update", accountId: "b", patch: { label: "Home" } },
      { type: "account:reorder", order: ["b", "a", "c"] },
      { type: "account:update", accountId: "b", patch: { color: 2 } },
      { type: "account:remove", accountId: "b" },
      { type: "prefs:update", patch: { style: "cli" } },
      { type: "prefs:update", patch: { badge: false } },
    ]);
    expect(root.textContent).toContain("stored unencrypted in this Chrome profile");
  });

  it("escapes labels and emails", () => {
    mount(root, send, ui({ accounts: [acct("x", `<img src=x onerror=alert(1)>`)] }), () => NOW);
    expect(root.querySelector("img")).toBeNull();
    expect(root.textContent).toContain("<img src=x onerror=alert(1)>");
  });

  it("digits 1–9 switch from the list, never while typing or for signed-out rows", () => {
    mount(root, send, ui(), () => NOW);
    document.dispatchEvent(new KeyboardEvent("keydown", { code: "Digit2", key: "2", bubbles: true }));
    document.dispatchEvent(new KeyboardEvent("keydown", { code: "Digit3", key: "3", bubbles: true }));
    expect(send.mock.calls).toEqual([[{ type: "switch", accountId: "b" }]]);
    click('[data-action="manage"]');
    root.querySelector<HTMLInputElement>('[data-action="rename"]')!.dispatchEvent(new KeyboardEvent("keydown", { code: "Digit1", key: "1", bubbles: true }));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("shows an empty state", () => {
    mount(root, send, ui({ accounts: [], activeId: null, usage: {} }), () => NOW);
    expect(root.textContent).toContain("No accounts yet");
  });

  it("applyPrefs sets theme and style on <html>", () => {
    applyPrefs(document, ui({ prefs: { theme: "dark", style: "cli", inPageSwitcher: true, badge: true, rescueProbe: false } }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(document.documentElement.getAttribute("data-style")).toBe("cli");
    applyPrefs(document, ui());
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/popup.test.ts`
Expected: FAIL — `Cannot find module '../../src/popup/popup'`.

- [ ] **Step 3: Implement shared HTML helpers**

`src/shared/html.ts`:

```ts
import { ACCOUNT_COLORS } from "./types";

const ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ENTITIES[c] ?? c);
}

export function avatarHtml(label: string, color: number): string {
  const n = ACCOUNT_COLORS.length;
  const bg = ACCOUNT_COLORS[((color % n) + n) % n];
  const initial = (label.trim().charAt(0) || "?").toUpperCase();
  return `<span class="avatar" style="background:${bg}" aria-hidden="true">${esc(initial)}</span>`;
}
```

- [ ] **Step 4: Implement the view**

`src/popup/view.ts`:

```ts
import { avatarHtml, esc } from "../shared/html";
import type { PublicAccount, UiState } from "../shared/types";
import { formatAge, levelOf, resetTitle } from "../shared/usageFormat";

export type Screen = "list" | "manage" | "addIntro";
export interface ViewState {
  screen: Screen;
  confirmRemoveId: string | null;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const labelOf = (s: UiState, id: string | null) => s.accounts.find((a) => a.id === id)?.label ?? "account";
const head = (title: string, back = false) =>
  `<header class="head">${back ? `<button class="btn ghost back" data-action="back" aria-label="Back">‹</button>` : ""}<span class="title">${esc(title)}</span></header>`;

export function usageLine(a: PublicAccount, s: UiState, now: number): string {
  const snap = s.usage[a.id];
  if (!snap || snap.limits.length === 0) return "";
  const active = a.id === s.activeId;
  const items = snap.limits
    .slice(0, 3)
    .map((l) => {
      const p = Math.round(l.percent);
      return `<span class="u ${levelOf(l.percent)}"><span class="ul">${esc(l.label)}</span> <span class="num">${p}%</span><span class="ubar"><i style="width:${p}%"></i></span></span>`;
    })
    .join(`<span class="dot"> · </span>`);
  const asOf = active ? "" : `<span class="asof"> · as of ${esc(formatAge(now - snap.fetchedAt))}</span>`;
  return `<span class="usage${active ? "" : " stale"}" title="${esc(resetTitle(snap.limits, now))}">${items}${asOf}</span>`;
}

function row(a: PublicAccount, i: number, s: UiState, now: number): string {
  const active = a.id === s.activeId;
  const signedOut = a.status === "signedOut";
  const right =
    s.switchingTo === a.id
      ? `<span class="spinner" aria-label="Switching"></span>`
      : active
        ? `<span class="check" aria-label="Active">✓</span>`
        : i < 9
          ? `<span class="kbd">⌥${i + 1}</span>`
          : `<span></span>`;
  const sub = signedOut ? `<span class="err">signed out — sign in again</span>` : `<span class="email">${esc(a.email)}</span>`;
  return `<button class="row${active ? " active" : ""}" data-action="${signedOut ? "signin" : "switch"}" data-id="${esc(a.id)}">${avatarHtml(a.label, a.color)}<span class="who"><span class="label">${esc(a.label)}</span>${sub}${signedOut ? "" : usageLine(a, s, now)}</span><span class="badge">${esc(a.plan)}</span>${right}</button>`;
}

function renderList(s: UiState, now: number): string {
  const top = `<header class="head"><span class="title"><span class="claude">✻</span> Claude accounts</span><span class="kbd" title="Open this popup">⌥⇧A</span></header>`;
  const status = s.switchingTo
    ? `<div class="status"><span class="spinner"></span> Switching to ${esc(labelOf(s, s.switchingTo))}…</div>`
    : s.lastSwitch && now - s.lastSwitch.at < 10_000
      ? `<div class="status muted">Reloaded ${plural(s.lastSwitch.reloadedTabs, "claude.ai tab")}</div>`
      : "";
  const error = s.error ? `<div class="error" role="alert">${esc(s.error)}</div>` : "";
  const body = s.accounts.length
    ? `<div class="list">${s.accounts.map((a, i) => row(a, i, s, now)).join("")}</div>`
    : `<div class="empty"><p>No accounts yet.</p><p class="muted">Add the claude.ai account you're signed into, then add the others.</p></div>`;
  const foot = `<footer class="foot"><button class="btn ghost" data-action="addIntro">+ Add account</button><button class="btn ghost" data-action="manage">Manage</button><span class="muted count">${plural(s.accounts.length, "account")}</span></footer>`;
  return top + status + error + body + foot;
}

function renderAddIntro(): string {
  return `${head("Add account", true)}<div class="pane"><p>We'll keep the account you're signed into and open claude.ai signed out, so you can sign in with Google or email.</p><p class="muted">Open the email magic link in this Chrome profile.</p><button class="btn primary block" data-action="addStart">Open claude.ai login</button></div>`;
}

function renderAdd(s: UiState): string {
  const a = s.add;
  const target = s.accounts.find((x) => x.id === a.targetAccountId);
  switch (a.phase) {
    case "waitingLogin":
      return `${head("Add account")}<div class="pane"><p><span class="spinner"></span> Waiting for you to sign in${target ? ` as ${esc(target.email)}` : ""}…</p><p class="muted">Google or email magic link, in the claude.ai tab we opened. It gives up after 15 minutes.</p><button class="btn block" data-action="addCancel">Cancel</button></div>`;
    case "saved": {
      const acct = s.accounts.find((x) => x.id === a.savedAccountId);
      return `${head("Account saved")}<div class="pane"><p class="ok">✓ ${a.isNew ? "Saved" : "Updated"} ${esc(acct?.email ?? "")} · ${esc(acct?.plan ?? "")}</p><label class="field"><span class="muted">Label</span><input class="input" id="label" maxlength="32" value="${esc(acct?.label ?? "")}"></label><button class="btn primary block" data-action="addDone" data-id="${esc(a.savedAccountId ?? "")}">Done</button></div>`;
    }
    case "mismatch":
      return `${head("Different account")}<div class="pane"><p>You signed in as ${esc(a.mismatchEmail ?? "")}, not ${esc(target?.email ?? "the account you picked")}.</p><button class="btn primary block" data-action="mismatchAdd">Add ${esc(a.mismatchEmail ?? "")} as a new account</button><button class="btn block" data-action="mismatchCancel">Cancel</button></div>`;
    case "error":
      return `${head("Something went wrong")}<div class="pane"><p class="err">${esc(a.message ?? "")}</p><button class="btn block" data-action="addDismiss">Close</button></div>`;
    default:
      return "";
  }
}

function renderManage(s: UiState, v: ViewState): string {
  const rows = s.accounts
    .map((a, i) => {
      const isActive = a.id === s.activeId;
      return `<div class="mrow"><button class="avatar-btn" data-action="color" data-id="${esc(a.id)}" title="Change colour">${avatarHtml(a.label, a.color)}</button><input class="input slim" data-action="rename" data-id="${esc(a.id)}" value="${esc(a.label)}" maxlength="32" aria-label="Label for ${esc(a.email)}"><button class="btn ghost icon" data-action="up" data-id="${esc(a.id)}" aria-label="Move up"${i === 0 ? " disabled" : ""}>↑</button><button class="btn ghost icon" data-action="down" data-id="${esc(a.id)}" aria-label="Move down"${i === s.accounts.length - 1 ? " disabled" : ""}>↓</button><button class="btn ghost danger" data-action="remove" data-id="${esc(a.id)}"${isActive ? ' disabled title="Switch to another account first"' : ""}>${v.confirmRemoveId === a.id ? "Confirm" : "Remove"}</button></div>`;
    })
    .join("");
  const seg = (pref: "theme" | "style", options: string[], current: string) =>
    `<div class="seg" role="group" aria-label="${pref}">${options.map((o) => `<button data-action="pref" data-pref="${pref}" data-value="${o}" aria-pressed="${o === current}">${o}</button>`).join("")}</div>`;
  const toggle = (pref: "inPageSwitcher" | "badge" | "rescueProbe", label: string) =>
    `<div class="prefrow"><span>${label}</span><button class="switch" role="switch" data-action="toggle" data-pref="${pref}" aria-checked="${s.prefs[pref]}"></button></div>`;
  return `${head("Manage", true)}<div class="pane">${rows || `<p class="muted">No accounts yet.</p>`}</div><hr class="divider"><div class="pane prefs"><div class="prefrow"><span>Theme</span>${seg("theme", ["system", "dark", "light"], s.prefs.theme)}</div><div class="prefrow"><span>Style</span>${seg("style", ["app", "cli"], s.prefs.style)}</div>${toggle("inPageSwitcher", "Switcher on claude.ai")}${toggle("badge", "Usage badge on the toolbar icon")}${toggle("rescueProbe", "Find links in my accounts (experimental)")}<p class="muted note">Saved sessions are stored unencrypted in this Chrome profile. Removing an account only forgets it here; it doesn't sign it out.</p></div>`;
}

export function render(s: UiState, v: ViewState, now: number): string {
  if (s.add.phase !== "idle") return renderAdd(s);
  if (v.screen === "addIntro") return renderAddIntro();
  if (v.screen === "manage") return renderManage(s, v);
  return renderList(s, now);
}
```

- [ ] **Step 5: Implement mounting, events and bootstrap**

`src/popup/popup.ts`:

```ts
import type { Request } from "../shared/messages";
import type { Prefs, UiState } from "../shared/types";
import { ACCOUNT_COLORS } from "../shared/types";
import { render, type ViewState } from "./view";

export type Send = (req: Request) => Promise<unknown>;

export function applyPrefs(doc: Document, s: UiState): void {
  const html = doc.documentElement;
  if (s.prefs.theme === "system") html.removeAttribute("data-theme");
  else html.setAttribute("data-theme", s.prefs.theme);
  html.setAttribute("data-style", s.prefs.style);
}

export function mount(root: HTMLElement, send: Send, initial: UiState, now: () => number = Date.now) {
  let state = initial;
  const view: ViewState = { screen: "list", confirmRemoveId: null };
  const doc = root.ownerDocument;
  const fire = (req: Request) => void send(req).catch(() => undefined);

  const draw = () => {
    const typedLabel = root.querySelector<HTMLInputElement>("#label")?.value;
    applyPrefs(doc, state);
    root.innerHTML = render(state, view, now());
    const label = root.querySelector<HTMLInputElement>("#label");
    if (label && typedLabel !== undefined) label.value = typedLabel;
  };

  root.addEventListener("click", (e) => {
    const el = (e.target as Element | null)?.closest<HTMLElement>("[data-action]");
    if (!el || (el instanceof HTMLButtonElement && el.disabled)) return;
    const id = el.dataset.id ?? "";
    switch (el.dataset.action) {
      case "switch":
        fire({ type: "switch", accountId: id });
        break;
      case "signin":
        fire({ type: "addAccount:start", targetAccountId: id });
        break;
      case "addIntro":
        view.screen = "addIntro";
        draw();
        break;
      case "addStart":
        view.screen = "list";
        fire({ type: "addAccount:start" });
        break;
      case "addCancel":
        fire({ type: "addAccount:cancel" });
        break;
      case "addDone": {
        const label = root.querySelector<HTMLInputElement>("#label")?.value ?? "";
        void send({ type: "account:update", accountId: id, patch: { label } })
          .then(() => send({ type: "addAccount:dismiss" }))
          .catch(() => undefined);
        break;
      }
      case "addDismiss":
        fire({ type: "addAccount:dismiss" });
        break;
      case "mismatchAdd":
        fire({ type: "addAccount:resolveMismatch", addAsNew: true });
        break;
      case "mismatchCancel":
        fire({ type: "addAccount:resolveMismatch", addAsNew: false });
        break;
      case "manage":
        view.screen = "manage";
        draw();
        break;
      case "back":
        view.screen = "list";
        view.confirmRemoveId = null;
        draw();
        break;
      case "color": {
        const a = state.accounts.find((x) => x.id === id);
        if (a) fire({ type: "account:update", accountId: id, patch: { color: (a.color + 1) % ACCOUNT_COLORS.length } });
        break;
      }
      case "up":
      case "down": {
        const order = state.accounts.map((a) => a.id);
        const i = order.indexOf(id);
        const j = el.dataset.action === "up" ? i - 1 : i + 1;
        if (i < 0 || j < 0 || j >= order.length) break;
        [order[i], order[j]] = [order[j]!, order[i]!];
        fire({ type: "account:reorder", order });
        break;
      }
      case "remove":
        if (view.confirmRemoveId === id) {
          view.confirmRemoveId = null;
          fire({ type: "account:remove", accountId: id });
        } else {
          view.confirmRemoveId = id;
          draw();
        }
        break;
      case "pref": {
        const pref = el.dataset.pref as "theme" | "style";
        fire({ type: "prefs:update", patch: { [pref]: el.dataset.value } as Partial<Prefs> });
        break;
      }
      case "toggle": {
        const pref = el.dataset.pref as "inPageSwitcher" | "badge" | "rescueProbe";
        fire({ type: "prefs:update", patch: { [pref]: !state.prefs[pref] } });
        break;
      }
    }
  });

  root.addEventListener("change", (e) => {
    const el = e.target as HTMLInputElement;
    if (el.dataset.action === "rename" && el.dataset.id) fire({ type: "account:update", accountId: el.dataset.id, patch: { label: el.value } });
  });

  doc.addEventListener("keydown", (e) => {
    if (view.screen !== "list" || state.add.phase !== "idle" || e.target instanceof HTMLInputElement) return;
    const m = /^Digit([1-9])$/.exec(e.code);
    const a = m ? state.accounts[Number(m[1]) - 1] : undefined;
    if (a && a.status === "ok") fire({ type: "switch", accountId: a.id });
  });

  draw();
  return {
    update(next: UiState) {
      state = next;
      draw();
    },
    current: () => state,
    view,
  };
}
```

`src/popup/main.ts` (replaces the stub):

```ts
import { sendToBackground, type Push } from "../shared/messages";
import type { UiState } from "../shared/types";
import { mount } from "./popup";

void (async () => {
  const root = document.getElementById("app");
  if (!root) return;
  const initial = await sendToBackground<UiState>({ type: "getState" });
  const app = mount(root, (req) => sendToBackground(req), initial);
  chrome.runtime.onMessage.addListener((msg: unknown) => {
    const push = msg as Push | undefined;
    if (push?.type === "state") app.update(push.state);
    return false;
  });
  setInterval(() => app.update(app.current()), 5_000); // lets "Reloaded N tabs" and "as of" ages refresh
})();
```

`src/popup/popup.css` (replaces the stub):

```css
body { width: 320px; min-height: 120px; margin: 0; background: var(--bg); }
.popup { display: flex; flex-direction: column; }
.head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 12px; border-bottom: 0.5px solid var(--border); }
.head .title { display: inline-flex; align-items: center; gap: 6px; font-weight: 600; font-size: var(--fs-md); margin-right: auto; }
.back { width: 24px; padding: 0; }
.status { display: flex; align-items: center; gap: 6px; padding: 6px 12px; font-size: var(--fs-xs); border-bottom: 0.5px solid var(--border); }
.error { margin: 8px 12px 0; padding: 6px 8px; border-radius: var(--r-md); background: var(--claude-tint); color: var(--error); font-size: var(--fs-xs); }
.list { display: flex; flex-direction: column; padding: 4px; }
.row { display: grid; grid-template-columns: 22px 1fr auto 26px; align-items: center; gap: 8px; width: 100%; padding: 7px 8px; border: 0; border-radius: var(--r-md); background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.row:hover, .row:focus-visible { background: var(--surface-2); outline: none; }
.who { display: flex; flex-direction: column; min-width: 0; gap: 1px; }
.label { font-weight: 500; }
.email { color: var(--muted); font-size: var(--fs-xs); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.usage { display: flex; flex-wrap: wrap; align-items: center; gap: 0 2px; font-size: var(--fs-xxs); color: var(--text-2); font-family: var(--font-mono); }
.usage.stale { color: var(--faint); }
.u { display: inline-flex; align-items: center; gap: 3px; }
.u .num { font-variant-numeric: tabular-nums; }
.ubar { display: inline-block; width: 22px; height: 3px; border-radius: 2px; background: var(--track); overflow: hidden; }
.ubar i { display: block; height: 100%; background: var(--success); }
.u.warn .ubar i { background: var(--warning); }
.u.crit .ubar i { background: var(--error); }
.u.crit .num { color: var(--error); }
.usage.stale .ubar i { opacity: 0.5; }
.dot, .asof { color: var(--faint); }
.check { color: var(--claude); text-align: center; }
.row .kbd, .row .spinner { justify-self: center; }
.empty { padding: 16px 12px; }
.empty p { margin: 0 0 4px; }
.foot { display: flex; align-items: center; gap: 4px; padding: 6px 8px; border-top: 0.5px solid var(--border); }
.foot .count { margin-left: auto; font-size: var(--fs-xs); }
.pane { display: flex; flex-direction: column; gap: 8px; padding: 12px; }
.pane p { margin: 0; }
.field { display: flex; flex-direction: column; gap: 4px; }
.mrow { display: grid; grid-template-columns: 26px 1fr 24px 24px auto; align-items: center; gap: 6px; }
.avatar-btn { border: 0; background: transparent; padding: 0; cursor: pointer; }
.input.slim { height: 26px; }
.icon { width: 24px; padding: 0; }
.danger { color: var(--error); }
.prefrow { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.note { font-size: var(--fs-xxs); }
.spinner { display: inline-block; width: 12px; }
.btn[disabled] { opacity: 0.45; cursor: default; }
```

- [ ] **Step 6: Run tests, typecheck, build; eyeball against the prototype**

Run: `pnpm vitest run && pnpm typecheck && pnpm build`
Expected: PASS, tsc exit 0, build OK. Then load `dist/` unpacked (manual) or rely on Task 12's screenshot to compare with `prototypes/shots/extension-dark-app.png` in the sibling claude-code-usage repo.

- [ ] **Step 7: Commit**

```bash
git add src/shared/html.ts src/popup tests/unit/popup.test.ts
git commit -m "feat: popup with account list, usage line, add flow and manage view"
```

---

### Task 11: Content script — in-page switcher, ⌥1–9, rescue banner

**Files:**
- Create: `src/content/styles.ts`, `src/content/host.ts`, `src/content/anchors.ts`, `src/content/keys.ts`, `src/content/switcherUi.ts`, `src/content/banner.ts`
- Modify (replace stub): `src/content/main.ts`
- Test: `tests/unit/content.test.ts`

**Interfaces:**
- Consumes: `Request`, `Push`, `sendToBackground` (Task 1); `UiState`, `RescueInfo`, `ProbeResult` (Task 1); `esc`, `avatarHtml` (Task 10).
- Produces:
  - `src/content/styles.ts`: `CONTENT_CSS: string`
  - `src/content/host.ts`: `HOST_ID = "claude-account-switcher-root"`, `ensureHost(doc: Document): ShadowRoot` (open shadow root, idempotent)
  - `src/content/anchors.ts`: `ANCHOR_SELECTORS: string[]`, `findAnchor(doc: Document): Element | null`, `placement(anchor: Element | null, viewport: { width: number; height: number }): { mode: "anchored" | "floating"; left: number; top: number }`
  - `src/content/keys.ts`: `isEditable(el: Element | null): boolean`, `digitShortcut(e: Pick<KeyboardEvent, "altKey" | "shiftKey" | "metaKey" | "ctrlKey" | "code">, active: Element | null): number | null`, `installKeys(win: Window, getAccounts: () => { id: string; status?: string }[], onSwitch: (accountId: string) => void): () => void`
  - `src/content/switcherUi.ts`: `interface SwitcherView { update(state: UiState): void; reposition(): void; destroy(): void; readonly element: HTMLElement }`, `createSwitcher(root: ShadowRoot, doc: Document, send: (req: Request) => void): SwitcherView`
  - `src/content/banner.ts`: `interface BannerView { show(info: RescueInfo): void; setState(state: UiState): void; hide(): void; readonly element: HTMLElement }`, `createBanner(root: ShadowRoot, doc: Document, send: (req: Request) => Promise<unknown>): BannerView`

- [ ] **Step 1: Write the failing test**

`tests/unit/content.test.ts`:

```ts
// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createBanner } from "../../src/content/banner";
import { ensureHost, HOST_ID } from "../../src/content/host";
import { digitShortcut, installKeys, isEditable } from "../../src/content/keys";
import { placement } from "../../src/content/anchors";
import { CONTENT_CSS } from "../../src/content/styles";
import { createSwitcher } from "../../src/content/switcherUi";
import type { PublicAccount, RescueInfo, UiState } from "../../src/shared/types";

const acct = (id: string, label: string, extra: Partial<PublicAccount> = {}): PublicAccount => ({
  id, email: `${label.toLowerCase()}@example.com`, name: label, label, color: 0, plan: "Pro", orgUuid: `org-${id}`, savedAt: 0, status: "ok", ...extra,
});
const state = (over: Partial<UiState> = {}): UiState => ({
  accounts: [acct("a", "Acme"), acct("b", "Personal"), acct("c", "Lab", { status: "signedOut" })],
  activeId: "a",
  prefs: { theme: "system", style: "app", inPageSwitcher: true, badge: true, rescueProbe: false },
  switchingTo: null,
  lastSwitch: null,
  add: { phase: "idle", targetAccountId: null, savedAccountId: null, isNew: false, mismatchEmail: null, message: null },
  usage: {},
  error: null,
  ...over,
});
const key = (code: string, mods: Partial<Record<"altKey" | "shiftKey" | "metaKey" | "ctrlKey", boolean>> = {}) => ({
  code, altKey: false, shiftKey: false, metaKey: false, ctrlKey: false, ...mods,
});

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("keys", () => {
  it("never steals ⌥digits while typing (⌥2 is '@' on a Spanish Mac keyboard)", () => {
    document.body.innerHTML = `<textarea id="t"></textarea><div id="pm" contenteditable="true"><p id="inner">x</p></div><input id="cb" type="checkbox">`;
    expect(digitShortcut(key("Digit2", { altKey: true }), document.getElementById("t"))).toBeNull();
    expect(digitShortcut(key("Digit2", { altKey: true }), document.getElementById("inner"))).toBeNull();
    expect(digitShortcut(key("Digit2", { altKey: true }), document.getElementById("cb"))).toBe(2);
    expect(digitShortcut(key("Digit2", { altKey: true }), document.body)).toBe(2);
  });

  it("only plain ⌥1–9", () => {
    expect(digitShortcut(key("Digit2"), document.body)).toBeNull();
    expect(digitShortcut(key("Digit2", { altKey: true, shiftKey: true }), document.body)).toBeNull();
    expect(digitShortcut(key("Digit2", { altKey: true, metaKey: true }), document.body)).toBeNull();
    expect(digitShortcut(key("Digit0", { altKey: true }), document.body)).toBeNull();
    expect(isEditable(null)).toBe(false);
  });

  it("installKeys switches to the nth account, skipping signed-out ones", () => {
    const onSwitch = vi.fn();
    const off = installKeys(window, () => state().accounts, onSwitch);
    const ev = new KeyboardEvent("keydown", { code: "Digit2", altKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(ev);
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Digit3", altKey: true, bubbles: true }));
    expect(onSwitch.mock.calls).toEqual([["b"]]);
    expect(ev.defaultPrevented).toBe(true);
    off();
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Digit2", altKey: true, bubbles: true }));
    expect(onSwitch).toHaveBeenCalledTimes(1);
  });
});

describe("host + placement", () => {
  it("creates one open shadow root that inherits the page font", () => {
    const a = ensureHost(document);
    const b = ensureHost(document);
    expect(a).toBe(b);
    expect(document.getElementById(HOST_ID)!.shadowRoot).toBe(a);
    expect(CONTENT_CSS).toContain("font-family: inherit");
  });

  it("anchors next to the sidebar account button, else floats bottom-left", () => {
    expect(placement(null, { width: 1200, height: 800 })).toEqual({ mode: "floating", left: 12, top: 760 });
    const el = document.createElement("button");
    el.getBoundingClientRect = () => ({ left: 10, top: 740, right: 200, bottom: 772, width: 190, height: 32, x: 10, y: 740, toJSON: () => ({}) }) as DOMRect;
    expect(placement(el, { width: 1200, height: 800 })).toEqual({ mode: "anchored", left: 206, top: 742 });
  });
});

describe("in-page switcher", () => {
  it("opens a menu, switches, signs in again, adds, and hides when disabled", () => {
    const send = vi.fn();
    const view = createSwitcher(ensureHost(document), document, send);
    view.update(state());
    const root = view.element;
    expect(root.querySelector(".pill")!.textContent).toContain("Acme");
    root.querySelector<HTMLElement>('[data-action="toggle"]')!.click();
    expect(root.querySelector<HTMLElement>(".menu")!.hidden).toBe(false);
    expect(root.querySelector(".hint")!.textContent).toContain("⌥1–9");
    root.querySelector<HTMLElement>('[data-action="switch"][data-id="b"]')!.click();
    root.querySelector<HTMLElement>('[data-action="toggle"]')!.click();
    root.querySelector<HTMLElement>('[data-action="signin"][data-id="c"]')!.click();
    root.querySelector<HTMLElement>('[data-action="toggle"]')!.click();
    root.querySelector<HTMLElement>('[data-action="add"]')!.click();
    expect(send.mock.calls.map((c) => c[0])).toEqual([
      { type: "switch", accountId: "b" },
      { type: "addAccount:start", targetAccountId: "c" },
      { type: "addAccount:start" },
    ]);
    view.update(state({ prefs: { theme: "system", style: "app", inPageSwitcher: false, badge: true, rescueProbe: false } }));
    expect(root.hidden).toBe(true);
    view.destroy();
  });
});

describe("rescue banner", () => {
  const info = (over: Partial<RescueInfo> = {}): RescueInfo => ({
    resourceKey: "artifact:7f3c",
    kind: "artifact",
    currentAccountId: "a",
    candidates: [acct("b", "Personal"), acct("c", "Lab", { status: "signedOut" })],
    rememberedAccountId: null,
    ...over,
  });

  it("names the current account and offers Open as… for the others", async () => {
    const send = vi.fn(async () => null);
    const banner = createBanner(ensureHost(document), document, send);
    banner.setState(state());
    banner.show(info());
    const el = banner.element;
    expect(el.hidden).toBe(false);
    expect(el.textContent).toContain("This isn't in Acme (acme@example.com)");
    expect(el.querySelector<HTMLButtonElement>('[data-action="openAs"][data-id="c"]')!.disabled).toBe(true);
    expect(el.querySelector('[data-action="probe"]')).toBeNull();
    el.querySelector<HTMLElement>('[data-action="openAs"][data-id="b"]')!.click();
    expect(send).toHaveBeenCalledWith({ type: "rescue:openAs", accountId: "b", resourceKey: "artifact:7f3c" });
    expect(el.textContent).toContain("Switching");
  });

  it("highlights the remembered account and offers adding one when there are no others", () => {
    const send = vi.fn(async () => null);
    const banner = createBanner(ensureHost(document), document, send);
    banner.setState(state());
    banner.show(info({ rememberedAccountId: "b" }));
    expect(banner.element.textContent).toContain("Last opened as Personal");
    expect(banner.element.querySelector('[data-action="openAs"][data-id="b"]')!.classList.contains("primary")).toBe(true);
    banner.show(info({ resourceKey: "chat:x", candidates: [] }));
    banner.element.querySelector<HTMLElement>('[data-action="add"]')!.click();
    expect(send).toHaveBeenCalledWith({ type: "addAccount:start" });
  });

  it("probes when the pref is on and shows the results", async () => {
    const send = vi.fn(async () => [
      { accountId: "b", outcome: "found" },
      { accountId: "c", outcome: "signedOut" },
    ]);
    const banner = createBanner(ensureHost(document), document, send);
    banner.setState(state({ prefs: { theme: "system", style: "app", inPageSwitcher: true, badge: true, rescueProbe: true } }));
    banner.show(info());
    banner.element.querySelector<HTMLElement>('[data-action="probe"]')!.click();
    await vi.waitFor(() => expect(banner.element.textContent).toContain("✓ found"));
    expect(banner.element.textContent).toContain("– signed out");
    expect(send).toHaveBeenCalledWith({ type: "rescue:probe", resourceKey: "artifact:7f3c" });
  });

  it("escapes labels and can be dismissed", () => {
    const banner = createBanner(ensureHost(document), document, vi.fn(async () => null));
    banner.setState(state({ accounts: [acct("a", "<b>x</b>")] }));
    banner.show(info({ candidates: [] }));
    expect(banner.element.querySelector("b")).toBeNull();
    expect(banner.element.textContent).toContain("<b>x</b>");
    banner.element.querySelector<HTMLElement>('[data-action="close"]')!.click();
    expect(banner.element.hidden).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/unit/content.test.ts`
Expected: FAIL — modules under `src/content/` not found.

- [ ] **Step 3: Implement styles, host and anchors**

`src/content/styles.ts`:

```ts
/** Lives inside our shadow root; `font-family: inherit` picks up claude.ai's own typefaces. */
export const CONTENT_CSS = `
:host { all: initial; font-family: inherit; font-size: 13px; line-height: 1.4; color-scheme: light dark;
  --cas-bg: #faf9f5; --cas-surface: #f5f4ed; --cas-surface-2: #f0eee6; --cas-border: rgba(31,30,29,.14);
  --cas-text: #141413; --cas-muted: #73726c; --cas-claude: #c96442; --cas-err: #c4314b; --cas-ok: #2f8f46; }
@media (prefers-color-scheme: dark) { :host { --cas-bg: #262624; --cas-surface: #1f1e1d; --cas-surface-2: #30302e;
  --cas-border: rgba(222,220,209,.14); --cas-text: #faf9f5; --cas-muted: #9c9a92; --cas-claude: #d97757; --cas-err: #ff6b80; --cas-ok: #4eba65; } }
[hidden] { display: none !important; }
.cas-switch { position: fixed; z-index: 2147483646; color: var(--cas-text); font: inherit; }
.pill { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 8px 0 4px; border-radius: 14px;
  border: 0.5px solid var(--cas-border); background: var(--cas-surface); color: inherit; font: inherit; font-size: 12px; cursor: pointer; }
.pill:hover { background: var(--cas-surface-2); }
.avatar { display: inline-grid; place-items: center; flex: none; width: 20px; height: 20px; border-radius: 50%; color: #fff; font-size: 10px; font-weight: 600; }
.menu { position: absolute; bottom: 34px; left: 0; min-width: 240px; padding: 4px; border-radius: 12px; background: var(--cas-bg);
  border: 0.5px solid var(--cas-border); box-shadow: 0 12px 32px rgba(0,0,0,.25); }
.item { display: grid; grid-template-columns: 20px 1fr auto; gap: 8px; align-items: center; width: 100%; padding: 6px 8px; border: 0;
  border-radius: 8px; background: transparent; color: inherit; font: inherit; font-size: 12px; text-align: left; cursor: pointer; }
.item:hover { background: var(--cas-surface-2); }
.item .email { display: block; color: var(--cas-muted); font-size: 11px; }
.item .err { display: block; color: var(--cas-err); font-size: 11px; }
.check { color: var(--cas-claude); }
.kbd { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 10px; color: var(--cas-muted); }
.sep { height: 0.5px; background: var(--cas-border); margin: 4px 0; }
.hint { padding: 4px 8px; font-size: 10px; color: var(--cas-muted); }
.banner { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); z-index: 2147483647; width: min(520px, calc(100vw - 32px));
  padding: 10px 12px; border-radius: 12px; background: var(--cas-bg); color: var(--cas-text); border: 0.5px solid var(--cas-border);
  box-shadow: 0 12px 32px rgba(0,0,0,.25); font: inherit; font-size: 13px; }
.banner .title { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.banner .muted { color: var(--cas-muted); font-size: 12px; }
.actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.btn { height: 26px; padding: 0 10px; border-radius: 8px; border: 0.5px solid var(--cas-border); background: var(--cas-surface-2);
  color: inherit; font: inherit; font-size: 12px; cursor: pointer; }
.btn.primary { background: var(--cas-claude); border-color: transparent; color: #fff; }
.btn[disabled] { opacity: .5; cursor: default; }
.close { border: 0; background: transparent; color: var(--cas-muted); cursor: pointer; font: inherit; font-size: 16px; }
.results { margin: 8px 0 0; padding: 0; list-style: none; font-size: 12px; }
.found { color: var(--cas-ok); } .notfound { color: var(--cas-muted); } .err { color: var(--cas-err); }
`;
```

`src/content/host.ts`:

```ts
import { CONTENT_CSS } from "./styles";

export const HOST_ID = "claude-account-switcher-root";

export function ensureHost(doc: Document): ShadowRoot {
  const existing = doc.getElementById(HOST_ID);
  if (existing?.shadowRoot) return existing.shadowRoot;
  const host = doc.createElement("div");
  host.id = HOST_ID;
  const root = host.attachShadow({ mode: "open" });
  const style = doc.createElement("style");
  style.textContent = CONTENT_CSS;
  root.appendChild(style);
  (doc.body ?? doc.documentElement).appendChild(host);
  return root;
}
```

`src/content/anchors.ts`:

```ts
/** claude.ai DOM hooks — update after docs/notes/spike.md (#8). */
export const ANCHOR_SELECTORS = ['[data-testid="user-menu-button"]', 'button[data-testid*="user-menu"]'];

export function findAnchor(doc: Document): Element | null {
  for (const sel of ANCHOR_SELECTORS) {
    const el = doc.querySelector(sel);
    if (el) return el;
  }
  return null;
}

const PILL_HEIGHT = 28;

export function placement(
  anchor: Element | null,
  viewport: { width: number; height: number },
): { mode: "anchored" | "floating"; left: number; top: number } {
  const floating = { mode: "floating" as const, left: 12, top: viewport.height - 12 - PILL_HEIGHT };
  if (!anchor) return floating;
  const r = anchor.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return floating;
  return {
    mode: "anchored",
    left: Math.min(r.right + 6, viewport.width - 40),
    top: Math.max(8, Math.round(r.top + r.height / 2 - PILL_HEIGHT / 2)),
  };
}
```

- [ ] **Step 4: Implement keys, switcher and banner**

`src/content/keys.ts`:

```ts
const NON_TEXT_INPUTS = new Set(["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "image"]);

export function isEditable(el: Element | null): boolean {
  if (!el) return false;
  if ((el as HTMLElement).isContentEditable) return true;
  if (el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true;
  if (el.tagName === "INPUT") return !NON_TEXT_INPUTS.has((el as HTMLInputElement).type);
  return el.closest('[contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]') !== null;
}

/** ⌥1–9 → 1..9, but never while typing: on a Spanish Mac keyboard ⌥1 "|", ⌥2 "@", ⌥3 "#". */
export function digitShortcut(
  e: Pick<KeyboardEvent, "altKey" | "shiftKey" | "metaKey" | "ctrlKey" | "code">,
  active: Element | null,
): number | null {
  if (!e.altKey || e.shiftKey || e.metaKey || e.ctrlKey) return null;
  const m = /^Digit([1-9])$/.exec(e.code);
  if (!m || isEditable(active)) return null;
  return Number(m[1]);
}

export function installKeys(
  win: Window,
  getAccounts: () => { id: string; status?: string }[],
  onSwitch: (accountId: string) => void,
): () => void {
  const onKey = (e: KeyboardEvent) => {
    const n = digitShortcut(e, win.document.activeElement);
    if (n === null) return;
    const account = getAccounts()[n - 1];
    if (!account || account.status === "signedOut") return;
    e.preventDefault();
    e.stopPropagation();
    onSwitch(account.id);
  };
  win.addEventListener("keydown", onKey, true);
  return () => win.removeEventListener("keydown", onKey, true);
}
```

`src/content/switcherUi.ts`:

```ts
import type { Request } from "../shared/messages";
import { avatarHtml, esc } from "../shared/html";
import type { UiState } from "../shared/types";
import { findAnchor, placement } from "./anchors";

export interface SwitcherView {
  update(state: UiState): void;
  reposition(): void;
  destroy(): void;
  readonly element: HTMLElement;
}

export function createSwitcher(root: ShadowRoot, doc: Document, send: (req: Request) => void): SwitcherView {
  const win = doc.defaultView!;
  const wrap = doc.createElement("div");
  wrap.className = "cas-switch";
  wrap.hidden = true;
  root.appendChild(wrap);
  let state: UiState | null = null;
  let open = false;

  const reposition = () => {
    const p = placement(findAnchor(doc), { width: win.innerWidth, height: win.innerHeight });
    wrap.dataset.placement = p.mode;
    wrap.style.left = `${p.left}px`;
    wrap.style.top = `${p.top}px`;
  };

  const draw = () => {
    if (!state || !state.prefs.inPageSwitcher || state.accounts.length === 0) {
      wrap.hidden = true;
      return;
    }
    wrap.hidden = false;
    const s = state;
    const active = s.accounts.find((a) => a.id === s.activeId);
    const items = s.accounts
      .map((a, i) => {
        const signedOut = a.status === "signedOut";
        const right = a.id === s.activeId ? `<span class="check">✓</span>` : i < 9 ? `<span class="kbd">⌥${i + 1}</span>` : "<span></span>";
        const sub = signedOut ? `<span class="err">signed out — sign in again</span>` : `<span class="email">${esc(a.email)}</span>`;
        return `<button class="item" role="menuitem" data-action="${signedOut ? "signin" : "switch"}" data-id="${esc(a.id)}">${avatarHtml(a.label, a.color)}<span><span class="label">${esc(a.label)}</span>${sub}</span>${right}</button>`;
      })
      .join("");
    wrap.innerHTML = `<button class="pill" data-action="toggle" aria-haspopup="menu" aria-expanded="${open}">${active ? avatarHtml(active.label, active.color) : ""}<span>${esc(active?.label ?? "Accounts")}</span><span aria-hidden="true">▾</span></button><div class="menu" role="menu"${open ? "" : " hidden"}>${items}<div class="sep"></div><button class="item" data-action="add"><span></span><span>+ Add another account</span><span></span></button><div class="hint">⌥1–9 switch · ⌥⇧A popup</div></div>`;
    reposition();
  };

  const close = () => {
    open = false;
    draw();
  };

  wrap.addEventListener("click", (e) => {
    const el = (e.target as Element).closest<HTMLElement>("[data-action]");
    if (!el) return;
    const id = el.dataset.id ?? "";
    switch (el.dataset.action) {
      case "toggle":
        open = !open;
        draw();
        break;
      case "switch":
        close();
        send({ type: "switch", accountId: id });
        break;
      case "signin":
        close();
        send({ type: "addAccount:start", targetAccountId: id });
        break;
      case "add":
        close();
        send({ type: "addAccount:start" });
        break;
    }
  });

  const onDocClick = (e: MouseEvent) => {
    if (open && !e.composedPath().includes(wrap)) close();
  };
  const onEsc = (e: KeyboardEvent) => {
    if (open && e.key === "Escape") close();
  };
  doc.addEventListener("click", onDocClick, true);
  doc.addEventListener("keydown", onEsc, true);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const observer = new win.MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(reposition, 300); // claude.ai re-renders a lot; reposition once it settles
  });
  observer.observe(doc.body, { childList: true, subtree: true });
  win.addEventListener("resize", reposition);

  return {
    update(next) {
      state = next;
      draw();
    },
    reposition,
    destroy() {
      observer.disconnect();
      clearTimeout(timer);
      doc.removeEventListener("click", onDocClick, true);
      doc.removeEventListener("keydown", onEsc, true);
      win.removeEventListener("resize", reposition);
      wrap.remove();
    },
    element: wrap,
  };
}
```

`src/content/banner.ts`:

```ts
import type { Request } from "../shared/messages";
import { esc } from "../shared/html";
import type { ProbeResult, RescueInfo, UiState } from "../shared/types";

export interface BannerView {
  show(info: RescueInfo): void;
  setState(state: UiState): void;
  hide(): void;
  readonly element: HTMLElement;
}

const MARK: Record<ProbeResult["outcome"], string> = {
  found: `<span class="found">✓ found</span>`,
  notFound: `<span class="notfound">✗ not found</span>`,
  signedOut: `<span class="notfound">– signed out</span>`,
  error: `<span class="err">! error</span>`,
};

export function createBanner(root: ShadowRoot, doc: Document, send: (req: Request) => Promise<unknown>): BannerView {
  const el = doc.createElement("div");
  el.className = "banner";
  el.hidden = true;
  el.setAttribute("role", "alert");
  root.appendChild(el);
  let info: RescueInfo | null = null;
  let state: UiState | null = null;
  let results: ProbeResult[] | null = null;
  let probing = false;

  const draw = () => {
    if (!info || !state) {
      el.hidden = true;
      return;
    }
    const i = info;
    el.hidden = false;
    const current = state.accounts.find((a) => a.id === i.currentAccountId);
    const where = current ? `${esc(current.label)} <span class="muted">(${esc(current.email)})</span>` : "this account";
    const remembered = i.candidates.find((a) => a.id === i.rememberedAccountId);
    const outcome = (id: string) => results?.find((r) => r.accountId === id)?.outcome;
    const buttons = i.candidates
      .map((a) => {
        const o = outcome(a.id);
        const disabled = a.status === "signedOut" || o === "notFound" || o === "signedOut";
        const primary = o === "found" || (!results && a.id === i.rememberedAccountId);
        return `<button class="btn${primary ? " primary" : ""}" data-action="openAs" data-id="${esc(a.id)}"${disabled ? " disabled" : ""}>Open as ${esc(a.label)}${a.status === "signedOut" ? " · signed out" : ""}</button>`;
      })
      .join("");
    const extra =
      i.candidates.length === 0
        ? `<button class="btn" data-action="add">+ Add another account</button>`
        : state.prefs.rescueProbe && !results
          ? `<button class="btn" data-action="probe"${probing ? " disabled" : ""}>${probing ? "Checking…" : "Find in my accounts"}</button>`
          : "";
    const list = results
      ? `<ul class="results">${results.map((r) => `<li>${esc(i.candidates.find((c) => c.id === r.accountId)?.label ?? r.accountId)} … ${MARK[r.outcome]}</li>`).join("")}</ul>`
      : "";
    el.innerHTML = `<div class="title"><span>This isn't in ${where}</span><button class="close" data-action="close" aria-label="Dismiss">×</button></div>${remembered ? `<div class="muted">Last opened as ${esc(remembered.label)}</div>` : ""}${list}<div class="actions">${buttons}${extra}</div>`;
  };

  el.addEventListener("click", (e) => {
    const t = (e.target as Element).closest<HTMLElement>("[data-action]");
    if (!t || (t instanceof HTMLButtonElement && t.disabled) || !info) return;
    const resourceKey = info.resourceKey;
    switch (t.dataset.action) {
      case "close":
        info = null;
        draw();
        break;
      case "add":
        void send({ type: "addAccount:start" }).catch(() => undefined);
        break;
      case "openAs":
        void send({ type: "rescue:openAs", accountId: t.dataset.id ?? "", resourceKey }).catch(() => undefined);
        el.innerHTML = `<div class="title"><span>Switching…</span></div>`;
        break;
      case "probe":
        probing = true;
        draw();
        void send({ type: "rescue:probe", resourceKey })
          .then((r) => {
            results = Array.isArray(r) ? (r as ProbeResult[]) : [];
          })
          .catch(() => {
            results = [];
          })
          .finally(() => {
            probing = false;
            draw();
          });
        break;
    }
  });

  return {
    show(next) {
      if (info?.resourceKey !== next.resourceKey) results = null;
      info = next;
      draw();
    },
    setState(next) {
      state = next;
      draw();
    },
    hide() {
      info = null;
      draw();
    },
    element: el,
  };
}
```

`src/content/main.ts` (replaces the stub):

```ts
import { sendToBackground, type Push, type Request } from "../shared/messages";
import type { RescueInfo, UiState } from "../shared/types";
import { createBanner } from "./banner";
import { ensureHost } from "./host";
import { installKeys } from "./keys";
import { createSwitcher } from "./switcherUi";

void (async () => {
  let state = await sendToBackground<UiState>({ type: "getState" }).catch(() => null);
  if (!state) return;
  const root = ensureHost(document);
  const fire = (req: Request) => void sendToBackground(req).catch(() => undefined);
  const switcher = createSwitcher(root, document, fire);
  const banner = createBanner(root, document, (req) => sendToBackground(req));
  switcher.update(state);
  banner.setState(state);
  installKeys(window, () => state?.accounts ?? [], (accountId) => fire({ type: "switch", accountId }));

  chrome.runtime.onMessage.addListener((msg: unknown) => {
    const push = msg as Push | undefined;
    if (push?.type === "state") {
      state = push.state;
      switcher.update(push.state);
      banner.setState(push.state);
    } else if (push?.type === "rescue:show") {
      banner.show(push.rescue);
    }
    return false;
  });

  const rescue = await sendToBackground<RescueInfo | null>({ type: "rescue:get" }).catch(() => null);
  if (rescue) banner.show(rescue);
})();
```

- [ ] **Step 5: Run tests, typecheck, build**

Run: `pnpm vitest run && pnpm typecheck && pnpm build`
Expected: PASS, tsc exit 0, build OK.

- [ ] **Step 6: Commit**

```bash
git add src/content tests/unit/content.test.ts
git commit -m "feat: claude.ai in-page switcher, alt-digit shortcuts and rescue banner"
```

---

### Task 12: End-to-end test against a fake claude.ai

**Decision:** Playwright's `context.route` does not reliably intercept an extension service worker's own `fetch`. So the e2e build (`pnpm build:e2e`) bakes `http://localhost:4319` in as the origin (esbuild `define` + manifest rewrite from Task 1), and a tiny Node HTTP server plays claude.ai. Everything else is the production code.

**Files:**
- Create: `playwright.config.ts`, `tests/e2e/fakeClaude.ts`, `tests/e2e/fixtures.ts`, `tests/e2e/switching.spec.ts`

**Interfaces:**
- Consumes: the built extension in `dist-e2e/` (Tasks 1–11); popup selectors `[data-action="addIntro"]`, `[data-action="addStart"]`, `[data-action="addDone"]`, `[data-action="switch"]`, `.row .usage`; banner button text `Open as …` (open shadow root).
- Produces: `startFakeClaude(port?: number): Promise<http.Server>`, `FAKE_ORIGIN = "http://localhost:4319"`; Playwright fixtures `context` and `extensionId`. With `CAPTURE_SITE_SHOT=1`, writes `site/screenshot.png` (used by Task 13).

- [ ] **Step 1: Install Playwright**

Run: `pnpm add -D @playwright/test && pnpm exec playwright install chromium`
Expected: Chromium downloaded.

`playwright.config.ts`:

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  use: { trace: "retain-on-failure" },
});
```

- [ ] **Step 2: Write the fake claude.ai**

`tests/e2e/fakeClaude.ts`:

```ts
import http from "node:http";

export const FAKE_PORT = 4319;
export const FAKE_ORIGIN = `http://localhost:${FAKE_PORT}`;

interface FakeUser {
  uuid: string;
  email: string;
  name: string;
  org: string;
  tier: string | null;
  caps: string[];
  usage: unknown;
}

const USERS: Record<string, FakeUser> = {
  "sk-work": {
    uuid: "aaaaaaaa-0000-4000-8000-000000000001", email: "you@work.example", name: "You at work", org: "org-work",
    tier: "default_claude_max_20x", caps: ["chat", "claude_max"],
    usage: { limits: [
      { kind: "session", percent: 25, resets_at: "2026-10-01T22:30:00Z", scope: null },
      { kind: "weekly_all", percent: 54, resets_at: "2026-10-06T04:00:00Z", scope: null },
      { kind: "weekly_scoped", percent: 64, resets_at: "2026-10-06T04:00:00Z", scope: { model: { display_name: "Fable" } } },
    ] },
  },
  "sk-personal": {
    uuid: "bbbbbbbb-0000-4000-8000-000000000002", email: "you@personal.example", name: "You at home", org: "org-personal",
    tier: null, caps: ["chat", "claude_pro"],
    usage: { five_hour: { utilization: 10, resets_at: "2026-10-01T23:00:00Z" }, seven_day: { utilization: 20, resets_at: "2026-10-06T04:00:00Z" } },
  },
};
const ARTIFACT_OWNER: Record<string, string> = { "personal-only": "org-personal" };

function cookies(req: http.IncomingMessage): Record<string, string> {
  return Object.fromEntries((req.headers.cookie ?? "").split(/;\s*/).filter(Boolean).map((p) => {
    const i = p.indexOf("=");
    return [p.slice(0, i), decodeURIComponent(p.slice(i + 1))];
  }));
}

const page = (body: string) => `<!doctype html><html><head><meta charset="utf-8"><title>fake claude</title></head><body style="font-family: Georgia, serif">${body}</body></html>`;

export function startFakeClaude(port = FAKE_PORT): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);
    const jar = cookies(req);
    const user = USERS[jar.sessionKey ?? ""];
    const headers: Record<string, string | string[]> = {};
    if (!jar.cf_clearance) headers["set-cookie"] = [`cf_clearance=cf-${Math.random().toString(36).slice(2)}; Path=/; HttpOnly; SameSite=Lax`];
    const send = (status: number, type: string, body: string, extra: Record<string, string | string[]> = {}) => {
      res.writeHead(status, { "content-type": type, ...headers, ...extra });
      res.end(body);
    };
    const json = (status: number, body: unknown) => send(status, "application/json", JSON.stringify(body));

    if (url.pathname === "/login") {
      return send(200, "text/html", page(`<h1>Log in</h1><a id="as-work" href="/fake/login?as=work">Continue as work</a> <a id="as-personal" href="/fake/login?as=personal">Continue as personal</a>`));
    }
    if (url.pathname === "/fake/login") {
      const who = url.searchParams.get("as") === "personal" ? "sk-personal" : "sk-work";
      const set = [`sessionKey=${who}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`, `lastActiveOrg=${USERS[who]!.org}; Path=/; SameSite=Lax; Max-Age=86400`];
      return send(302, "text/plain", "", { location: "/new", "set-cookie": [...((headers["set-cookie"] as string[]) ?? []), ...set] });
    }
    if (url.pathname === "/api/bootstrap") {
      if (!user) return json(401, { error: "unauthorized" });
      return json(200, { account: { uuid: user.uuid, email_address: user.email, full_name: user.name, memberships: [
        { organization: { uuid: user.org, name: `${user.name}'s org`, capabilities: user.caps, rate_limit_tier: user.tier } },
      ] } });
    }
    const usage = /^\/api\/organizations\/([^/]+)\/usage$/.exec(url.pathname);
    if (usage) {
      if (!user) return json(401, {});
      return usage[1] === user.org ? json(200, user.usage) : json(403, {});
    }
    const artifactApi = /^\/api\/organizations\/([^/]+)\/artifacts\/([^/]+)$/.exec(url.pathname);
    if (artifactApi) {
      if (!user) return json(401, {});
      return artifactApi[1] === user.org && ARTIFACT_OWNER[artifactApi[2]!] === user.org ? json(200, { id: artifactApi[2] }) : json(404, { error: "not_found" });
    }
    if (url.pathname === "/new") return send(200, "text/html", page(`<p id="who">${user ? `Signed in as ${user.email}` : "Signed out"}</p>`));
    const artifactPage = /^\/artifact\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
    if (artifactPage) {
      const id = artifactPage[1]!;
      const org = user?.org ?? "none";
      return send(200, "text/html", page(`<p id="artifact">Loading…</p><script>
        fetch("/api/organizations/${org}/artifacts/${id}").then(r => {
          document.getElementById("artifact").textContent = r.ok ? "Artifact ${id}" : "Not found";
        });
      </script>`));
    }
    return send(404, "text/plain", "not found");
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}
```

`tests/e2e/fixtures.ts`:

```ts
import { chromium, test as base, type BrowserContext } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const test = base.extend<{ context: BrowserContext; extensionId: string }>({
  context: async ({}, use) => {
    const ext = path.resolve("dist-e2e");
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cas-e2e-"));
    const context = await chromium.launchPersistentContext(userDataDir, {
      channel: "chromium",
      headless: !process.env.HEADED,
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
    });
    await use(context);
    await context.close();
  },
  extensionId: async ({ context }, use) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    await use(new URL(worker.url()).host);
  },
});

export const expect = test.expect;
```

- [ ] **Step 3: Write the e2e spec (it fails until the build exists)**

`tests/e2e/switching.spec.ts`:

```ts
import type { BrowserContext, Page } from "@playwright/test";
import type http from "node:http";
import { FAKE_ORIGIN, startFakeClaude } from "./fakeClaude";
import { expect, test } from "./fixtures";

let server: http.Server;
test.beforeAll(async () => {
  server = await startFakeClaude();
});
test.afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

async function addAccount(context: BrowserContext, popup: Page, who: "work" | "personal") {
  await popup.locator('[data-action="addIntro"]').click();
  const loginOpened = context.waitForEvent("page");
  await popup.locator('[data-action="addStart"]').click();
  const login = await loginOpened;
  await login.waitForLoadState();
  await login.locator(`#as-${who}`).click();
  await expect(popup.getByText(/Saved you@/)).toBeVisible();
  await popup.locator('[data-action="addDone"]').click();
  await expect(popup.locator('[data-action="addIntro"]')).toBeVisible();
}

test("add two accounts, switch between them, rescue a link from the other account", async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`${FAKE_ORIGIN}/new`);
  await expect(page.locator("#who")).toHaveText("Signed out");
  const cfBefore = (await context.cookies(FAKE_ORIGIN)).find((c) => c.name === "cf_clearance")?.value;
  expect(cfBefore).toBeTruthy();

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);

  await addAccount(context, popup, "work");
  await expect(page.locator("#who")).toHaveText("Signed in as you@work.example");
  await addAccount(context, popup, "personal");
  await expect(page.locator("#who")).toHaveText("Signed in as you@personal.example");

  const second = await context.newPage();
  await second.goto(`${FAKE_ORIGIN}/new`);
  await popup.locator('[data-action="switch"]', { hasText: "you@work.example" }).click();
  await expect(page.locator("#who")).toHaveText("Signed in as you@work.example");
  await expect(second.locator("#who")).toHaveText("Signed in as you@work.example");
  await expect(popup.locator(".row.active")).toContainText("Work");
  await expect(popup.locator(".row.active .usage")).toContainText("5h 25%");
  await expect(popup.locator(".row", { hasText: "Personal" }).locator(".usage")).toContainText("as of");

  expect((await context.cookies(FAKE_ORIGIN)).find((c) => c.name === "cf_clearance")?.value).toBe(cfBefore);

  await page.goto(`${FAKE_ORIGIN}/artifact/personal-only`);
  await expect(page.locator("#artifact")).toHaveText("Not found");
  await page.getByRole("button", { name: /Open as Personal/ }).click();
  await expect(page.locator("#artifact")).toHaveText("Artifact personal-only");
  await expect(popup.locator(".row.active")).toContainText("Personal");

  if (process.env.CAPTURE_SITE_SHOT) {
    await popup.locator('[data-action="switch"]', { hasText: "you@work.example" }).click();
    await expect(popup.locator(".row.active")).toContainText("Work");
    await popup.setViewportSize({ width: 320, height: 240 });
    await popup.locator("#app").screenshot({ path: "site/screenshot.png" });
  }
});
```

- [ ] **Step 4: Run it**

Run: `pnpm test:e2e`
Expected: PASS (1 test). If identity fails with 401 from the service worker (SameSite cookies not attached to extension requests), stop and report — that is spike item #5 and needs a spec decision; do not weaken the test.
If the content-script/banner never appears, run `HEADED=1 pnpm test:e2e` and check the service worker console (`chrome://extensions` → Inspect views).

- [ ] **Step 5: Commit**

```bash
git add playwright.config.ts tests/e2e package.json pnpm-lock.yaml
git commit -m "test: end-to-end add/switch/rescue flow against a fake claude.ai"
```

---

### Task 13: Icons, packaging, docs and distribution files

**Files:**
- Create: `scripts/icons.mjs`, `src/icons/icon-{16,32,48,128}.png` (generated, committed)
- Modify: `src/manifest.json` (add `icons` and `action.default_icon`)
- Modify: `tests/unit/build.test.ts` (icons + zip assertions)
- Create: `LICENSE`, `README.md`, `site/index.html`, `site/tokens.css` (copy), `site/screenshot.png` (from Task 12)
- Create: `tests/e2e/site.spec.ts`

**Interfaces:**
- Consumes: `scripts/build.mjs` (copies `src/icons/` when present — Task 1); `CAPTURE_SITE_SHOT=1` screenshot (Task 12); `pnpm zip` script (Task 1) → `claude-account-switcher.zip`.
- Produces: release-ready `claude-account-switcher.zip` (unversioned name), landing page `site/` verified at 390 and 1280 px. Does NOT run `gh` or `vercel`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/build.test.ts`:

```ts
describe("packaging", () => {
  it("ships PNG icons referenced by the manifest", () => {
    const out = buildInto();
    const m = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
    for (const size of ["16", "32", "48", "128"]) {
      expect(m.icons[size]).toBe(`icons/icon-${size}.png`);
      expect(m.action.default_icon[size]).toBe(`icons/icon-${size}.png`);
      const png = readFileSync(join(out, m.icons[size]));
      expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
      expect(png.readUInt32BE(16)).toBe(Number(size));
    }
  });

  it("pnpm zip produces claude-account-switcher.zip with the manifest at its root", () => {
    execFileSync("pnpm", ["zip"], { stdio: "pipe" });
    const listing = execFileSync("unzip", ["-l", "claude-account-switcher.zip"], { encoding: "utf8" });
    expect(listing).toMatch(/\smanifest\.json\n/);
    expect(listing).toContain("icons/icon-128.png");
    expect(listing).not.toContain("dist/");
  });
});
```

`tests/e2e/site.spec.ts`:

```ts
import { expect, test } from "@playwright/test";
import path from "node:path";

const SITE = `file://${path.resolve("site/index.html")}`;
const DOWNLOAD = "https://github.com/Jeff909Dev/claude-account-switcher/releases/latest/download/claude-account-switcher.zip";

for (const width of [390, 1280]) {
  test(`landing page renders at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(SITE);
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.locator("#download")).toHaveAttribute("href", DOWNLOAD);
    await expect(page.getByRole("link", { name: /GitHub/ }).first()).toHaveAttribute("href", "https://github.com/Jeff909Dev/claude-account-switcher");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    expect(await page.locator(".shot img").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    await page.screenshot({ path: `test-results/site-${width}.png`, fullPage: true });
  });
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run tests/unit/build.test.ts`
Expected: FAIL — `m.icons` is undefined.

- [ ] **Step 3: Generate icons and reference them**

`scripts/icons.mjs`:

```js
#!/usr/bin/env node
// Draws the ✻-style mark (ivory asterisk on a clay disc) as PNGs with no dependencies.
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
function png(size, pixel) {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(size * stride);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0;
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel(x + 0.5, y + 0.5, size);
      const o = y * stride + 1 + x * 4;
      raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; raw[o + 3] = a;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const CLAY = [217, 119, 87];
const IVORY = [250, 249, 245];
const segDist = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};
function pixel(x, y, s) {
  const c = s / 2;
  const d = Math.hypot(x - c, y - c);
  if (d > c) return [0, 0, 0, 0];
  const alpha = Math.round(255 * Math.min(1, c - d));
  const arm = s * 0.3, w = Math.max(0.8, s * 0.07);
  for (let i = 0; i < 4; i++) {
    const ang = (i * Math.PI) / 4;
    const ax = c + Math.cos(ang) * arm, ay = c + Math.sin(ang) * arm;
    if (segDist(x, y, 2 * c - ax, 2 * c - ay, ax, ay) <= w) return [...IVORY, alpha];
  }
  return [...CLAY, alpha];
}
mkdirSync("src/icons", { recursive: true });
for (const size of [16, 32, 48, 128]) writeFileSync(`src/icons/icon-${size}.png`, png(size, pixel));
```

Run: `node scripts/icons.mjs`
Expected: four PNGs in `src/icons/`.

In `src/manifest.json`, add top-level `icons` and extend `action`:

```json
  "icons": { "16": "icons/icon-16.png", "32": "icons/icon-32.png", "48": "icons/icon-48.png", "128": "icons/icon-128.png" },
  "action": {
    "default_popup": "popup.html",
    "default_title": "Claude accounts",
    "default_icon": { "16": "icons/icon-16.png", "32": "icons/icon-32.png", "48": "icons/icon-48.png", "128": "icons/icon-128.png" }
  },
```

- [ ] **Step 4: Write LICENSE, README and the landing page**

`LICENSE`:

```
MIT License

Copyright (c) 2026 Jeff

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

`README.md`:

````markdown
# Claude Account Switcher

Keep several claude.ai accounts signed in and switch between them in one click — and open "not found"
links (artifacts, chats, projects) in the account they belong to. Each account row shows a one-line usage
readout (`5h 25% · week 54% · Fable 64%`). Unofficial; not affiliated with Anthropic.

## Install

1. Download `claude-account-switcher.zip` from the latest release and unzip it.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. **Load unpacked** → pick the unzipped folder. Pin the extension.

## Use

- **Add account**: popup → `+ Add account` → `Open claude.ai login`. The account you're signed into is kept;
  sign in with Google or the email magic link (open the link in this Chrome profile).
- **Switch**: click an account, press `1–9` in the popup, or `⌥1–9` on claude.ai (never while typing).
  `⌥⇧A` opens the popup. All claude.ai tabs reload as the new account.
- **Link from another account**: a banner offers `Open as …`. The choice is remembered.
- **Manage**: rename, reorder, colour, remove (only forgets it here — never signs it out).

## Privacy

Sessions stay in your browser (`chrome.storage.local`, unencrypted inside your Chrome profile). The
extension only talks to claude.ai. No server, no analytics, no tracking.

## Develop

```bash
pnpm install
pnpm test          # unit tests
pnpm test:e2e      # Playwright against a local fake claude.ai
pnpm build         # dist/ — Load unpacked from there
pnpm zip           # claude-account-switcher.zip
```

claude.ai assumptions live in `src/background/claudeApi.ts` and `src/content/anchors.ts`;
`docs/notes/spike.md` is the checklist to confirm them.

## Manual QA on real claude.ai (before each release)

1. Signed in as account 1, popup → Add account → sign in with Google as account 2: both listed, 2 active.
2. Add account 3 with the email magic link (opened in this profile).
3. With two claude.ai windows open, switch 3 → 1: every claude.ai tab reloads as 1 within 2 s.
4. Switch while a reply is streaming: the switch completes; no tab is left on the old account.
5. `⌥2` on claude.ai (not typing) switches; typing `@` (⌥2 on Spanish layout) in the composer still types `@`.
6. Open an artifact link created in account 2 while on 1: banner → Open as 2 → it loads.
7. Revoke account 2 from claude.ai settings on another device, switch to it: popup shows "signed out — sign in
   again"; browser stays on the previous account; Sign in again restores it.
8. No Cloudflare challenge appears after 10 switches.
9. Usage line shows live numbers for the active account; others show "as of …"; badge appears at ≥ 70 %.
10. Remove an inactive account, then confirm you're still signed in on the other ones.
````

Run: `mkdir -p site && cp src/shared/tokens.css site/tokens.css`

`site/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Claude Account Switcher</title>
    <meta name="description" content="Keep several claude.ai accounts signed in and switch between them in one click." />
    <link rel="stylesheet" href="tokens.css" />
    <style>
      :root { --font-ui: var(--font-sans); --fs-base: 15px; }
      body { line-height: 1.55; }
      main { max-width: 720px; margin: 0 auto; padding: 56px 16px 72px; }
      .mark { color: var(--claude); font-family: var(--font-mono); font-size: 20px; }
      h1 { font-family: var(--font-serif); font-weight: 400; font-size: clamp(28px, 6vw, 40px); line-height: 1.15; margin: 12px 0; }
      .lead { color: var(--text-2); font-size: 17px; margin: 0 0 24px; }
      .cta { display: flex; flex-wrap: wrap; gap: 10px; }
      .cta .btn { height: 40px; padding: 0 18px; font-size: 15px; text-decoration: none; }
      .shot { margin: 40px 0; padding: 16px; display: flex; justify-content: center; border-radius: var(--r-lg); border: 0.5px solid var(--border); background: var(--surface); }
      .shot img { max-width: 100%; height: auto; border-radius: var(--r-md); box-shadow: var(--shadow); }
      h2 { font-size: 15px; font-weight: 600; margin: 40px 0 12px; }
      ol { margin: 0; padding-left: 20px; }
      li { margin: 6px 0; color: var(--text-2); }
      code, .kbd { font-family: var(--font-mono); font-size: 13px; }
      .note { color: var(--muted); font-size: 14px; margin: 0; }
      footer { display: flex; flex-wrap: wrap; gap: 16px; margin-top: 48px; color: var(--muted); font-size: 13px; }
      a { color: var(--claude); }
    </style>
  </head>
  <body>
    <main>
      <span class="mark" aria-hidden="true">✻</span>
      <h1>Every Claude account, one click away.</h1>
      <p class="lead">A small Chrome extension that keeps all your claude.ai accounts signed in, switches between them instantly, and opens “not found” links in the account they belong to.</p>
      <div class="cta">
        <a class="btn primary" id="download" href="https://github.com/Jeff909Dev/claude-account-switcher/releases/latest/download/claude-account-switcher.zip">Download for Chrome</a>
        <a class="btn" href="https://github.com/Jeff909Dev/claude-account-switcher">View on GitHub</a>
      </div>
      <div class="shot"><img src="screenshot.png" width="320" alt="The extension popup listing two accounts with their usage" /></div>
      <h2>Install in three steps</h2>
      <ol>
        <li>Download and unzip <code>claude-account-switcher.zip</code>.</li>
        <li>Open <code>chrome://extensions</code> and turn on <b>Developer mode</b>.</li>
        <li>Click <b>Load unpacked</b>, pick the unzipped folder, pin it, then press <span class="kbd">⌥⇧A</span>.</li>
      </ol>
      <h2>Privacy</h2>
      <p class="note">Your sessions stay in your browser. The extension only talks to claude.ai — no server, no analytics, no tracking. Saved sessions are stored unencrypted inside your Chrome profile.</p>
      <footer><span>MIT licensed</span><a href="https://github.com/Jeff909Dev/claude-account-switcher">GitHub</a><span>Unofficial — not affiliated with Anthropic.</span></footer>
    </main>
  </body>
</html>
```

- [ ] **Step 5: Capture the screenshot, then run everything**

Run: `CAPTURE_SITE_SHOT=1 pnpm test:e2e`
Expected: PASS for `switching.spec.ts` and both `site.spec.ts` widths; `site/screenshot.png` written (≈320 px wide); `test-results/site-390.png` and `test-results/site-1280.png` written — open both and check the page looks right (no overflow, image visible, Claude look).

Run: `pnpm vitest run && pnpm typecheck && pnpm zip && unzip -l claude-account-switcher.zip | head`
Expected: all PASS; zip lists `manifest.json`, `background.js`, `popup.html`, `icons/…` at its root.

- [ ] **Step 6: Commit (do NOT create the GitHub repo/release or deploy — the controller does that)**

```bash
git add scripts/icons.mjs src/icons src/manifest.json tests/unit/build.test.ts tests/e2e/site.spec.ts LICENSE README.md site
git commit -m "chore: icons, packaging, README with QA checklist and landing page"
```

---

## Self-review notes (for the controller)

- Spec coverage: §2 rules → Tasks 3, 5, 6 (+ guardrails); §4.1 popup → Task 10; §4.2 add flow → Task 6 + Task 10; §4.3 in-page switcher → Task 11; §4.4 shortcuts → Task 1 manifest + Tasks 10/11; §4.5 rescue → Tasks 7, 9, 11; §4.6 usage → Tasks 2, 8, 9, 10; §5 architecture → File map (identity lives in `claudeApi.ts`, not a separate `identity.ts`); §6 data → Tasks 4, 8; §7 errors → Tasks 5, 6, 11; §8 look → Tasks 1, 10, 11, 13; §9 tests → every task + Task 12; §11 open checks → `docs/notes/spike.md`; §12 distribution → Task 13.
- Deliberate additions beyond the spec, flagged for Jeff: switching away from (or adding while signed into) an account the extension doesn't know saves it first, so a login is never destroyed; "Remove" is disabled for the active account; the add flow persists in `storage.session` and gives up after 15 min; ⌥1–9 never fires inside editable fields; same-domain default labels are de-duplicated.
