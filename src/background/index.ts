import { CLAUDE_API_PATTERN } from "../shared/env";
import type { Push, Reply } from "../shared/messages";
import type { UiState } from "../shared/types";
import { AccountStore } from "./accounts";
import { AddAccountFlow } from "./addAccount";
import { fetchUsageJson, whoAmI } from "./claudeApi";
import * as jar from "./cookieJar";
import { RescueTracker } from "./rescue";
import { broadcastPush, buildUiState, createRouter, isRequest, refreshUsage, type RouterDeps } from "./router";
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

const pushState = () => void broadcast().catch(() => console.warn("Could not send the latest state"));

/** The active account changed: fetch its usage. The badge follows the new account even when that fetch fails. */
const refreshUsageAndBroadcast = () =>
  void refreshUsage(routerDeps, 0)
    .then((fetched) => (fetched ? undefined : usage.updateBadge()))
    .catch(() => console.warn("Could not refresh usage"))
    .then(() => broadcast())
    .catch(() => console.warn("Could not send the latest state"));

const switcher = new Switcher(switchDeps, (switchingTo, result) => {
  if (switchingTo !== null) lastError = null; // a new attempt replaces the last error
  if (result?.status === "switched") {
    lastSwitch = { accountId: result.accountId, reloadedTabs: result.reloadedTabs, at: now() };
    refreshUsageAndBroadcast();
    return;
  }
  if (result?.status === "signedOut") lastError = "That account is signed out — sign in again.";
  if (result?.status === "error") lastError = result.message;
  pushState();
});

const addFlow = new AddAccountFlow(
  {
    ...switchDeps,
    session: chrome.storage.session,
    openLoginTab: async (url) => (await chrome.tabs.create({ url, active: true })).id ?? null,
    closeTab: (id) => chrome.tabs.remove(id),
  },
  (s) => {
    if (s.phase === "saved") {
      lastError = null; // e.g. a signed-out account has just been signed in again
      refreshUsageAndBroadcast();
    } else pushState();
  },
);

const rescue = new RescueTracker(store);

const routerDeps: RouterDeps = {
  store,
  switcher,
  addFlow,
  rescue,
  usage,
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
  void handle(msg, sender)
    .then(sendResponse)
    .catch(() => sendResponse({ ok: false, error: "The extension could not handle that request" } satisfies Reply));
  return true;
});

chrome.cookies.onChanged.addListener((info) => {
  void addFlow.onCookieChanged(info).catch(() => console.warn("Could not check the new claude.ai login"));
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
      })
      .catch(() => console.warn("Could not check a claude.ai link"));
  },
  { urls: [CLAUDE_API_PATTERN], types: ["xmlhttprequest"] },
);

chrome.tabs.onUpdated.addListener((tabId, change) => rescue.onTabUpdated(tabId, change));
chrome.tabs.onRemoved.addListener((tabId) => rescue.onTabRemoved(tabId));

void chrome.alarms
  .get(USAGE_ALARM)
  .then((alarm) => (alarm ? undefined : chrome.alarms.create(USAGE_ALARM, { periodInMinutes: USAGE_PERIOD_MIN })))
  .catch(() => console.warn("Could not schedule the usage refresh"));
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== USAGE_ALARM) return;
  void refreshUsage(routerDeps, 0)
    .then((fetched) => (fetched ? broadcast() : undefined))
    .catch(() => console.warn("Could not refresh usage"));
});

// Chrome clears the badge when the browser restarts or the extension is updated: show the stored numbers again.
const restoreBadge = () => void usage.updateBadge().catch(() => console.warn("Could not update the badge"));
chrome.runtime.onStartup.addListener(restoreBadge);
chrome.runtime.onInstalled.addListener(restoreBadge);
