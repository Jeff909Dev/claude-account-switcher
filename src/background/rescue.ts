import { parseResourceUrl, type ResourceRef } from "../shared/resourceKey";
import type { ProbeResult, RescueInfo } from "../shared/types";
import { orderedAccounts, toPublic, type AccountStore } from "./accounts";
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
    const remembered = s.resourceMap[m.ref.key]?.accountId ?? null;
    const candidates = orderedAccounts(s)
      .filter((a) => a.id !== s.activeId)
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
let nextRuleId = PROBE_RULE_BASE; // module-level so concurrent probes never share a rule id

/** A probe cut short by the service worker being killed leaves its Cookie-header rule behind: remove every probe rule. */
export async function removeStaleProbeRules(): Promise<void> {
  const stale = (await chrome.declarativeNetRequest.getSessionRules()).map((r) => r.id).filter((id) => id >= PROBE_RULE_BASE);
  if (stale.length > 0) await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: stale });
}

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
  const others = orderedAccounts(s).filter((a) => a.id !== s.activeId);
  const results: ProbeResult[] = [];
  for (const account of others) {
    if (account.status === "signedOut") {
      results.push({ accountId: account.id, outcome: "signedOut" });
      continue;
    }
    const ruleId = nextRuleId++;
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
