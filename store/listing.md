# Chrome Web Store listing — Account Switcher for Claude

Everything to paste into the Chrome Web Store Developer Dashboard, field by field. `SUBMIT.md` says where each
field is. Plain-text fields are in code blocks so they can be copied as they are.

## Package

- File: `claude-account-switcher.zip` from `pnpm zip` (the built `dist/`, `manifest.json` at its root).
- Version: 0.2.0 (`src/manifest.json`; `package.json` must match).

## Store listing tab

**Title** comes from the manifest `name` (27 characters):

```
Account Switcher for Claude
```

**Summary** comes from the manifest `description` (123 of 132 characters):

```
Keep several claude.ai accounts signed in and switch between them in one click. Unofficial — not affiliated with Anthropic.
```

**Description:**

```
Account Switcher for Claude keeps several claude.ai accounts signed in and lets you switch between them in one click, in the same window. Unofficial — not affiliated with Anthropic.

WHAT IT DOES
• Switch in one click: click an account in the popup, press 1–9 in the popup, or Alt+1–9 (⌥1–9 on Mac) on claude.ai. Every open claude.ai tab reloads signed in as that account.
• In-page switcher: a small switcher next to your account menu on claude.ai. You can turn it off.
• Links from another account: when an artifact, chat or project link isn't in the account you're using, a banner offers "Open as <account>". Your choice is remembered for next time.
• Usage at a glance: each account shows a one-line readout of its claude.ai usage limits (for example "5h 25% · week 54%"), and the toolbar badge warns when the active account passes 70%.
• Manage: rename, reorder, colour or remove accounts; system, light or dark theme.

HOW TO USE
1. Pin the extension and open it (or press Alt+Shift+A).
2. Click "+ Add account", then "Open claude.ai login". The account you're signed into is saved first, then claude.ai opens signed out so you can sign in to another account with Google or an email link (open the link in this Chrome profile).
3. Repeat for each account, then switch from the popup, the in-page switcher or the keyboard.
Removing an account only forgets it in the extension. It never signs you out of claude.ai.

PRIVACY
• Your sessions stay in your browser, in the extension's local storage inside your Chrome profile (unencrypted at rest, like all extension storage).
• The extension only talks to claude.ai, with the same kind of requests claude.ai's own pages make. No servers of ours, no analytics, no tracking, no ads. Your data is never sold or shared.
• Privacy policy: https://claude-account-switcher.vercel.app/privacy.html
• Open source (MIT): https://github.com/Jeff909Dev/claude-account-switcher

Unofficial — not affiliated with, endorsed by or supported by Anthropic. Claude is a trademark of Anthropic, PBC, named here only to say which service this extension works with.
```

**Category:** Productivity. If the dashboard asks for a sub-category, pick **Tools** (or **Workflow & Planning**).

**Language:** English.

**Graphic assets:**

| Field | File |
|---|---|
| Store icon (128×128) | `store/icon-128.png` |
| Screenshots (1280×800), in this order | `store/screenshots/1-switch-accounts.png`, `2-in-page-switcher.png`, `3-open-as.png`, `4-manage-and-privacy.png` |
| Small promo tile (440×280) | `store/promo-440x280.png` |
| Marquee promo tile, promo video | leave empty |

The screenshots are the real extension (popup, in-page switcher, "Open as …" banner, Manage) from the e2e build,
running against the local fake claude.ai with example accounts (`you@work.example`, `you@personal.example`).
To render them again: `CAPTURE_STORE=1 pnpm test:e2e`. The promo tile's source is `store/promo-440x280.html`.

**Additional fields:**

| Field | Value |
|---|---|
| Official URL | None (needs a site verified in Search Console; not needed) |
| Homepage URL | `https://claude-account-switcher.vercel.app` |
| Support URL | `https://github.com/Jeff909Dev/claude-account-switcher/issues` |
| Mature content | No |

## Privacy tab

**Single purpose description:**

```
Lets you keep several claude.ai accounts signed in within one Chrome profile and switch between them. Everything the extension does serves that purpose: saving and restoring each account's claude.ai login, an in-page switcher and keyboard shortcuts on claude.ai, opening claude.ai links in the account they belong to, and showing each saved account's claude.ai usage.
```

**Permission justifications** (one field per permission):

`cookies`

```
Switching accounts works by swapping claude.ai cookies. The extension reads the claude.ai cookies to save the account you're signed into, removes them so you can sign in to another account, and restores the saved cookies of the account you pick. It only touches claude.ai cookies (its only host permission is https://claude.ai/*) and leaves Cloudflare's browser cookies alone. Saved cookies stay in the extension's local storage and only ever go back to claude.ai, through the browser itself.
```

`storage`

```
Keeps the user's saved accounts (claude.ai cookies, email, name, plan, label and colour), the last usage numbers of each account, the remembered "Open as" choices and the preferences in chrome.storage.local, and the state of an account being added in chrome.storage.session (so Cancel can restore the previous login). Nothing is synced or sent off the device.
```

`alarms`

```
One alarm, every 15 minutes, refreshes the active account's claude.ai usage numbers shown in the popup and on the toolbar badge, so they stay current while the service worker is asleep.
```

`webRequest`

```
Read-only. The extension listens to webRequest.onCompleted for https://claude.ai/api/* only, to notice when a claude.ai page's own request for an artifact, chat or project answers 403 or 404. That means the link belongs to another account, so the extension shows its "Open as …" banner on that page. It doesn't block or change requests, doesn't read their bodies and doesn't record them.
```

Host permission `https://claude.ai/*`

```
The extension only works on claude.ai and asks for no other site. It needs claude.ai to read, save and restore claude.ai cookies (switching accounts); to ask claude.ai from the background who is signed in and how much usage is left; to see claude.ai's own responses for the "Open as …" banner; to run its content script on claude.ai pages (in-page switcher, banner, Alt+1–9 shortcuts); and to find and reload the open claude.ai tabs after a switch.
```

**Remote code:** select **No, I am not using remote code**. Justification, if a field asks for one:

```
All code ships in the package (background.js, popup.js, content.js, bundled with esbuild). The extension loads no external scripts, uses no eval or new Function, and fetches no remote configuration; its only network requests are JSON calls to claude.ai's own API.
```

**Data usage** — what to tick under "What user data do you plan to collect from users now or in the future?".
Nothing ever leaves the browser except requests to claude.ai, but the extension does handle this data on the
user's device, so it is declared. Declaring more never causes a rejection; declaring less can.

| Category | Tick | What exactly |
|---|---|---|
| Personally identifiable information | **Yes** | Email address and name of each saved claude.ai account, as claude.ai reports them; stored locally to label the accounts. |
| Health information | No | |
| Financial and payment information | No | The plan name (Pro, Max…) is shown, but no payment data is read. |
| Authentication information | **Yes** | The claude.ai session cookies of each saved account, stored locally to switch accounts. |
| Personal communications | No | Chats, files and messages are never read. |
| Location | No | |
| Web history | **Yes** | The ids of claude.ai links the user chose to "Open as" in another account (the 500 most recent), stored locally; the URL of claude.ai tabs is read to recognise such links. |
| User activity | **Yes** | Network monitoring limited to the status code of claude.ai's own API responses (`webRequest`, read-only, never stored) and the Alt+1–9 shortcuts on claude.ai. No keystroke logging. |
| Website content | No | Page content is never read; the content script only looks for claude.ai's account-menu button to place the switcher. |

Then tick all three certifications:

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:**

```
https://claude-account-switcher.vercel.app/privacy.html
```

## Distribution tab

- Payments: free.
- Visibility: **Public** (or **Unlisted** to share it by link only; it can be made public later).
- Regions: all regions.

## Test instructions tab (notes for the reviewer)

```
The extension works with any claude.ai account, including free ones. Two accounts show everything.
1. Sign in at https://claude.ai with account A, then pin the extension and open it (Alt+Shift+A).
2. Click "+ Add account", then "Open claude.ai login". Account A is saved and claude.ai opens signed out in a new tab. Sign in with account B: the popup lists A and B.
3. Click A in the popup (or press Alt+1 on a claude.ai page): every claude.ai tab reloads signed in as A. The popup shows a one-line usage readout per account.
4. While signed in as A, open the link of a chat or artifact that belongs to B: a banner says "This isn't in A" and offers "Open as B", which switches and opens it.
5. Manage → Remove forgets an account in the extension only; it never signs it out of claude.ai.
No servers of our own are involved: the extension only talks to claude.ai. Source: https://github.com/Jeff909Dev/claude-account-switcher
```

Only add login details if you want the reviewer to use accounts you provide: use throwaway accounts, never your
own.
