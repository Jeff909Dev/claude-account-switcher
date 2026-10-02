import { parseResourceUrl, type ResourceRef } from "../shared/resourceKey";
import type { RescueInfo } from "../shared/types";
import { orderedAccounts, toPublic, type AccountStore } from "./accounts";
import { isResourceMiss } from "./claudeApi";
import type { SwitchResult } from "./switcher";

export interface Miss {
  ref: ResourceRef;
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
    this.misses.set(d.tabId, { ref });
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
