# Account Switcher for Claude

Keep several claude.ai accounts signed in and switch between them in one click — and open "not found"
links (artifacts, chats, projects) in the account they belong to. Each account row shows a one-line usage
readout (`5h 25% · week 54% · Fable 64%`). Unofficial — not affiliated with Anthropic.

## Install

1. Download `claude-account-switcher.zip` from the latest release and unzip it.
2. Open `chrome://extensions` and turn on **Developer mode**.
3. **Load unpacked** → pick the unzipped folder. Pin the extension.

## Use

- **Add account**: popup → `+ Add account` → `Open claude.ai login`. The account you're signed into is saved
  first, then claude.ai opens signed out: sign in with Google or the email magic link (open the link in this
  Chrome profile).
- **Switch**: click an account, press `1–9` in the popup, or `Alt+1–9` (`⌥1–9` on Mac) on claude.ai (never
  while typing). `Alt+Shift+A` (`⌥⇧A` on Mac) opens the popup. All claude.ai tabs reload as the new account.
  On claude.ai, `Alt+N` goes to the extension only when account N exists, isn't signed out and you're not
  typing — on Linux it then wins over Chrome's own `Alt+1–9` tab switching; any other `Alt+digit` still
  switches tabs.
- **Link from another account**: a banner offers `Open as …`. The choice is remembered.
- **Manage**: rename, reorder, colour, remove (only forgets it here — never signs it out).

## Privacy

Sessions stay in your browser (`chrome.storage.local`, unencrypted inside your Chrome profile). The
extension only talks to claude.ai. No server, no analytics, no tracking. Full
[privacy policy](https://claude-account-switcher.vercel.app/privacy.html) (source: `site/privacy.html`).

## Develop

Needs Node 22.12+ and pnpm.

```bash
pnpm install
pnpm exec playwright install chromium   # once, before the first pnpm test:e2e
pnpm test          # unit tests
pnpm test:e2e      # Playwright against a local fake claude.ai
pnpm build         # dist/ — Load unpacked from there
pnpm zip           # claude-account-switcher.zip
```

claude.ai assumptions live in `src/background/claudeApi.ts` and `src/content/anchors.ts`;
`docs/notes/spike.md` is the checklist to confirm them.

## Manual QA on real claude.ai (before each release)

0. Run the `docs/notes/spike.md` checklist first and update the code and fixtures it points to.
1. In DevTools → Application → Cookies → `https://claude.ai`, confirm `sessionKey`, `lastActiveOrg` and every
   other account cookie are `Secure`. A non-Secure account cookie is invisible to the extension and would
   leak across accounts.
2. Signed in as account 1, popup → Add account → sign in with Google as account 2: both listed, 2 active.
3. Add account 3 with the email magic link (opened in this profile).
4. Confirm the background fetch sends the login cookies on real claude.ai: after a switch, the account's
   identity and usage line both load (no "signed out" state).
5. With two claude.ai windows open, switch 3 → 1: every claude.ai tab reloads as 1 within 2 s.
6. Switch while a reply is streaming: the switch completes; no tab is left on the old account.
7. `⌥2` on claude.ai (not typing) switches; typing `@` (⌥2 on Spanish layout) in the composer still types `@`.
8. Open an artifact link created in account 2 while on 1: banner → Open as 2 → it loads.
9. Repeat 8 with a chat (`/chat/…`), a project (`/project/…`) and a Claude Code artifact (`/code/artifact/…`)
   from account 2: each shows the banner and opens as 2 (spike check 4 names the request that must fail).
10. Revoke account 2 from claude.ai settings on another device, switch to it: popup shows "signed out — sign in
    again"; browser stays on the previous account; Sign in again restores it.
11. No Cloudflare challenge appears after 10 switches.
12. Usage line shows live numbers for the active account; others show "as of …"; badge appears at ≥ 70 %.
13. On an account that belongs to a Team org and a personal org, pick each org in claude.ai, switch away and
    back: the plan badge and usage numbers are for the org in use (claude.ai's `lastActiveOrg` cookie).
14. Leave Chrome idle for at least 60 s (`chrome://serviceworker-internals` shows the extension's worker
    stopped), then open a link from another account: the banner appears; press `⌥2`: it switches. This
    confirms that claude.ai requests and content-script messages wake the worker.
15. Quit Chrome completely and reopen it: the popup lists every account with ✓ on the active one, and a switch
    still works.
16. In the console of a claude.ai tab, `document.getElementById("claude-account-switcher-root").shadowRoot`
    is `null`: the page's scripts can't read the in-page switcher (closed shadow root).
17. Remove an inactive account, then confirm you're still signed in on the other ones.
