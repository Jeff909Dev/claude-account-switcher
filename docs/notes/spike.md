# Spike — confirm claude.ai facts (Jeff, ~15 min, real claude.ai)

Everything the extension assumes about claude.ai lives in `src/background/claudeApi.ts` (network paths
and response shapes), except the usage parser `parseUsage` in `src/background/usage.ts` and the page
ROUTES in `src/shared/resourceKey.ts`, plus `src/content/anchors.ts`. Fill the Result column, then
update those files (and the fixtures in `tests/fixtures/`) — nothing else should need to change.

| # | Check | How | Result |
|---|---|---|---|
| 1 | Cookie names | DevTools on claude.ai → Application → Cookies → `https://claude.ai`. List every name, mark HttpOnly ones. Confirm the session cookie is `sessionKey`. | |
| 2 | Identity endpoint | Console on claude.ai: `await (await fetch('/api/bootstrap')).json()`. Note the paths of account uuid, email, name, memberships[].organization.{uuid,name,capabilities,rate_limit_tier}. If 404, try `/api/account` and `/api/organizations`. Save a scrubbed copy as `tests/fixtures/bootstrap.json`. Then a dead login: in an Incognito window on claude.ai (signed out), run `document.cookie = "sessionKey=bogus; path=/; secure"; (await fetch('/api/bootstrap')).status` and note whether it is 401 or 403 (and the status with no `sessionKey` at all). `getJson` maps both 401 and 403 to `AuthError`, and a switch treats any `AuthError` as "signed out": if a dead session answers 401 and 403 only comes from Cloudflare or blocked requests, map 403 to `NetworkError` instead. | |
| 3 | Usage endpoint | Console: `const org = (await (await fetch('/api/organizations')).json())[0].uuid; await (await fetch('/api/organizations/' + org + '/usage')).json()`. Note whether it has `limits[]` and/or `five_hour` / `seven_day` / `seven_day_<model>`. Save scrubbed as `tests/fixtures/usage-limits.json`. | |
| 4 | Resource miss | DevTools Network (Fetch/XHR) open, then open a link from ANOTHER account: an artifact (`/artifact/…`), a chat (`/chat/…`), a project (`/project/…`), a Claude Code artifact (`/code/artifact/…`). For each: the API URL that answers 403/404 and whether it contains the id from the page URL. The rescue banner needs, for every kind, a Fetch/XHR request (webRequest type `xmlhttprequest`) under `/api/` that answers 403 or 404 and whose path contains the exact id from the page URL — `ROUTES` in `src/shared/resourceKey.ts` plus `isResourceMiss` in `claudeApi.ts`. Check `/chat/{uuid}`, `/project/{uuid}` and `/code/artifact/{id}` one by one; if a kind fails only through a request without the id (or answers 200 with an error body), note it: the banner won't show for that kind. | |
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
