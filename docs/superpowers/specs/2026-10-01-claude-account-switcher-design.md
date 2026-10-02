# Claude Account Switcher — Chrome extension · Design

Date: 2026-10-01 · Status: draft for review · Repo: `claude-account-switcher`
Sibling project: Claude Usage (macOS menu bar app) — the `claude-code-usage` repo, own spec.
Visual reference: `prototypes/extension.html` in the `claude-code-usage` repo.
**Update 2026-10-02 (Chrome Web Store prep, v0.2.0):** the product is renamed **Account Switcher for Claude**
(repo name unchanged), "Find in my accounts" is removed, and the `tabs` and `declarativeNetRequestWithHostAccess`
permissions are dropped. See the dated notes in §4.5, §4.6, §5, §6, §11 and §12.

## 1. Intent

Jeff uses several Claude accounts in Chrome. claude.ai is single-account per browser profile, so moving between
accounts means logging out/in, and links that belong to another account (artifacts shared by Claude, chats,
projects) just show "not found" until he guesses the right account. The extension keeps every account signed in
and switches between them instantly, in the same window.

**Said by Jeff:** add an account, then add another, then switch between them from an interface — very fast; the
artifact case ("it's not in this account, which one did I create it in?") is the motivating pain; minimal Claude look.
**Assumed (correct me):** Chrome (and Chromium browsers) on desktop; one Chrome profile; accounts are claude.ai
consumer/team logins (Google or email magic link); no server of our own.

**Success criteria**
- Switching accounts takes ≤ 1 click (popup) or one shortcut, and all claude.ai tabs reload as the new account in < 2 s.
- Adding an account never logs out the others.
- On a claude.ai link that doesn't exist in the current account, a banner offers the other accounts, and opening it
  in the right one takes one click.
- No Cloudflare challenges or broken sessions caused by switching.

## 2. How it works

claude.ai keeps the login in first-party cookies on `claude.ai` (the session cookie is `sessionKey`, httpOnly).
An extension with the `cookies` permission and `https://claude.ai/*` host access can read and write httpOnly
cookies. Each account = a saved **cookie set**. Switching = save the current set, replace it with the target
set, reload claude.ai tabs.

Rules:
- Save/restore **all** `claude.ai` cookies except the browser-bound ones that must stay as they are:
  `__cf_bm`, `cf_clearance`, `_cfuvid` (Cloudflare). Keeping them avoids new bot challenges.
- **Never** trigger claude.ai's logout: it revokes the session server-side and would kill the saved account.
  "Add account" clears the auth cookies locally instead; "Remove account" only deletes our saved copy.
- Before every switch, re-snapshot the outgoing account (claude.ai rotates/extends cookies), so the saved set stays fresh.
- After every switch, confirm identity with an authenticated claude.ai API call; 401/403 → mark the account
  "signed out — sign in again".

## 3. Approaches considered

1. **Cookie-set swap in one profile (recommended).** Instant, same window, works for every claude.ai URL.
   Cost: one account active per profile at a time (switching affects all claude.ai tabs).
2. Separate Chrome profiles per account: native, but separate windows and no "open this link in account X".
3. Container-style per-tab cookie isolation: not available to Chrome extensions (Firefox-only API).

Chosen: **1**.

## 4. Features (v1)

1. **Toolbar popup** (320 px): account list (avatar initial, label, email, plan badge, ✓ active, `⌥1…⌥9`
   hints), click to switch with inline "Switching…" state and "Reloaded N claude.ai tabs"; signed-out accounts show
   "sign in again"; footer "+ Add account" and "Manage" (rename, reorder, remove, colour).
2. **Add account flow**: snapshot current → clear auth cookies → open `https://claude.ai/login` in a tab →
   user signs in with Google or email magic link (the magic link opens in Chrome, same profile, so it lands in the
   cleared session) → `cookies.onChanged` sees a new `sessionKey` → identity call → save → ask for a label
   (prefilled). Cancel restores the previous account.
3. **In-page switcher** on claude.ai: a small injected control (Shadow DOM, inherits claude.ai's fonts) pinned near
   the sidebar's account area, falling back to a floating pill bottom-left if the anchor isn't found. Opens an
   upward menu with accounts + "Add another account".
4. **Shortcuts**: `Alt+Shift+A` opens the popup (`_execute_action`); on claude.ai pages `Alt+1…9` switch directly
   (content-script keydown); popup also accepts `1…9`.
5. **Link rescue** (artifacts, chats, projects): when a claude.ai page's own API call for the page resource returns
   404/403 (observed via `webRequest.onCompleted`, read-only), the content script shows a banner: "This isn't in
   <label> (<email>)" with the other accounts:
   - **Open as <account>** buttons (switch + reload + remember).
   - Remembered mapping `resourceId → accountId` in storage; next visit offers it first.
   - *Removed 2026-10-02:* **Find in my accounts**, which probed each saved account without switching by injecting
     its `Cookie` header through a `declarativeNetRequest` session rule. It shipped off by default
     (`prefs.rescueProbe`) and was never verified on real claude.ai (spike check 6). It was removed before the
     Chrome Web Store submission, together with the `declarativeNetRequestWithHostAccess` permission, its startup
     rule sweep, its pref and its UI. **Open as …** is the only way to rescue a link.

6. **Usage at a glance** (very simple, independent of the menu bar app): each account row in the popup shows a
   one-line mini readout — two thin bars `5h 25% · week 54%` plus the model-scoped weekly limit when present
   (`Fable 64%`); hover/title shows reset times. The active account's numbers are live; other accounts show the
   last snapshot taken while they were active, muted with "as of 2h ago" (2026-10-02: they are never refreshed in
   the background; that needed the cookie-injection probe removed in §4.5). The toolbar badge shows the active account's
   highest % when it is ≥ 70 (warn colour) / ≥ 90 (critical colour), empty otherwise (pref, default on).
   Source: claude.ai's own usage endpoint for the active org (candidate `GET /api/organizations/{orgUuid}/usage`,
   confirmed in the spike), parsed tolerantly (`limits[]` if present, else `five_hour` / `seven_day` /
   `seven_day_<model>`). Refresh on popup open if older than 60 s, after every switch, and every 15 min via
   `chrome.alarms`. No history, charts or costs — that is the menu bar app's job.

## 5. Architecture

```
manifest.json            # MV3; permissions: cookies, storage, alarms, webRequest
                         # host_permissions: https://claude.ai/*
src/background/
  index.ts               # wires listeners, message router
  cookieJar.ts           # snapshot(), clear(), restore() over chrome.cookies; PRESERVE list
  accounts.ts            # AccountStore over chrome.storage.local (accounts, order, activeId, resourceMap)
  identity.ts            # whoAmI(): authenticated claude.ai API call → {accountUuid, email, name, orgs, plan}
  switcher.ts            # switchTo(id): lock, snapshot outgoing, restore target, reload tabs, verify
  addAccount.ts          # add flow state machine (idle → waitingLogin → saving → done / cancelled)
  rescue.ts              # 404 detection per tab, "Open as" + remember mapping
  usage.ts               # fetch + parse usage for the active org, snapshots per account, badge, alarm
src/popup/               # popup.html + popup.ts + popup.css (vanilla TS, tokens from tokens.css)
src/content/             # claude.ai content script: in-page switcher, rescue banner, Alt+N keys (Shadow DOM)
src/shared/              # types, message contracts, tokens.css
tests/unit/              # Vitest with an in-memory chrome.* fake
tests/e2e/               # Playwright: Chromium with the unpacked extension against a fake claude.ai (routed)
```

Units talk through typed messages (`{type:"switch", accountId}` etc.). `cookieJar`, `accounts`, `identity` know
nothing about UI; `switcher` and `addAccount` are the only orchestrators; popup and content script are views.

**Permissions (2026-10-02, least privilege for the Chrome Web Store):** `tabs` is dropped: `tabs.query({url})`
only needs to match claude.ai tabs, and `tabs.get(…).url` / `tabs.onUpdated`'s `url` are only read for
claude.ai tabs, which the `https://claude.ai/*` host permission already reveals; `reload`, `create`, `remove` and
`sendMessage` need no permission. `declarativeNetRequestWithHostAccess` went with "Find in my accounts" (§4.5).
What is left: `cookies` (save/restore the login), `storage` (accounts, usage, prefs), `alarms` (15-min usage
refresh), `webRequest` (see a claude.ai API call answer 403/404, read-only) and the claude.ai host permission
(cookies, identity/usage calls, content script). A unit test checks that the manifest asks for exactly the
permissions the `chrome.*` APIs in `src/` need, and the chrome fake hides tab URLs outside the host permission.

## 6. Data

`chrome.storage.local`:
- `accounts[]`: `{id (accountUuid), email, name, label, color, plan, orgUuid, cookies: Cookie[], savedAt, status}`
- `usage: {[accountId]: {limits: {kind, label, percent, resetsAt}[], fetchedAt}}`
- `activeId`, `order[]`, `resourceMap: {[resourceKey]: {accountId, at}}` (the 500 most recent), `prefs: {theme, style, inPageSwitcher, badge}`
  (2026-10-02: `rescueProbe` is gone; a stored value is dropped on load).
Cookies are stored as returned by `chrome.cookies.getAll` (name, value, domain, path, secure, httpOnly, sameSite,
expirationDate, hostOnly, storeId), restored with `chrome.cookies.set` (url derived from domain/path/secure).
Security note: `storage.local` is readable only by this extension but is plain on disk inside the Chrome profile;
the popup's Manage view says so. No data leaves the browser except normal requests to claude.ai.
2026-10-02: Remove account also deletes the account's usage snapshot at once (before, it lasted until the next
refresh), so the privacy policy (`site/privacy.html`) can promise that Remove deletes everything stored for it.

## 7. Error handling

- Switch is serialized with a lock; a second request while switching is queued (last wins).
- Restore failure mid-way → restore the previous set (we snapshot before clearing) and show the error.
- Identity check 401/403 after switch → status `signedOut`; popup row offers "Sign in again" (runs add flow
  targeted at that account: on success, replaces its cookies when the identity matches; mismatch → asks whether to
  add as a new account).
- claude.ai DOM anchor missing → floating pill fallback; never block the page.

## 8. Look & feel

Shared tokens from `prototypes/tokens.css` (claude.ai neutrals, Claude Code orange `#d97757`, 0.5 px dividers,
small type). Default style "Claude" (sans + mono numbers), optional "CLI" (all mono). Injected UI uses
`font-family: inherit` so on claude.ai it renders in Anthropic's own fonts.

## 9. Testing

- Unit (Vitest, chrome fake): snapshot excludes Cloudflare cookies; restore sets exactly the saved set; switch
  order (snapshot → clear → restore → reload → verify); lock/queue; add-flow state machine incl. cancel;
  resource-key parsing for `/artifact/{id}`, `/chat/{uuid}`, `/project/{uuid}`, `/code/artifact/{uuid}`;
  signed-out marking.
- E2E (Playwright + `--load-extension`): fake claude.ai served via routing — login page sets `sessionKey=A|B`,
  identity endpoint answers per cookie, resource endpoint 404s for A and 200s for B. Flows: add two accounts,
  switch via popup, tabs reload as other account, rescue banner → Open as B.
- Manual checklist on real claude.ai (in the plan), since automated tests must not use real accounts.

## 10. Out of scope (v1)

Two accounts active simultaneously in different tabs, Firefox/Safari, syncing accounts across machines,
usage history/charts/costs (the menu bar app does that), console.anthropic.com accounts.

## 11. Open checks (plan task 1 spike, before building on them)

- Exact identity endpoint and response (candidates: `/api/account`, `/api/bootstrap`, `/api/organizations`).
- Usage endpoint for the active org and its response shape (candidate `/api/organizations/{orgUuid}/usage`).
- Which API request a resource page makes and its 404 shape (artifact, chat, project, code artifact).
- ~~Whether `declarativeNetRequest` modifies the `Cookie` header on requests from the extension's own service worker
  (`TAB_ID_NONE`) — gates "Find in my accounts"; otherwise ship "Open as…" only.~~ Closed 2026-10-02: the feature
  was removed (§4.5), so nothing depends on it.
- Whether any non-cookie state (localStorage) must be cleared on switch to avoid stale UI.

## 12. Distribution (requested by Jeff, 2026-10-01)

- Public GitHub repo `Jeff909Dev/claude-account-switcher` (MIT). Secret scan before the first push.
- GitHub Release `v0.1.0` with asset `claude-account-switcher.zip` (unversioned name so the `latest/download` link is stable) (the built `dist/`, from `pnpm zip`). Chrome Web
  Store publishing is out of scope; install = unzip → `chrome://extensions` → Developer mode → Load unpacked.
- Landing page: `site/index.html` — one static page in the Claude look (tokens.css), hero line, one screenshot,
  **Download** (→ `https://github.com/Jeff909Dev/claude-account-switcher/releases/latest/download/claude-account-switcher.zip`),
  3-step install with the Load-unpacked steps, privacy note (cookies stay in your browser), link to GitHub.
  No framework, no analytics. Deployed to Vercel from `site/`.
- **Update 2026-10-02 (requested by Jeff): Chrome Web Store.** Publishing on the store is now in scope (it was out
  of scope above). v0.2.0 is renamed **Account Switcher for Claude** with the "Unofficial — not affiliated with
  Anthropic." disclaimer in the manifest description, uses only the permissions in §5, and has a privacy policy at
  `site/privacy.html` (`https://claude-account-switcher.vercel.app/privacy.html`). `store/` holds the listing text,
  permission justifications and data-use answers (`listing.md`), the screenshots, promo tile and icon, and the
  submission steps (`SUBMIT.md`). The GitHub release zip stays as a Load-unpacked alternative.
