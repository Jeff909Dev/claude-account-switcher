import { CLAUDE_TAB_PATTERN } from "../shared/env";
import type { Identity, StoredCookie } from "../shared/types";
import type { AccountStore } from "./accounts";
import { AuthError } from "./claudeApi";
import { hasLiveSession, selectedOrg } from "./cookieJar";

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
    identity = await deps.api.whoAmI(selectedOrg(cookies));
  } catch (e) {
    // Only a dead session (401) means there is nothing to save; any other failure must not lead to clearing a live login.
    if (e instanceof AuthError && e.status === 401) return { savedTo: null, cookies, isNew: false };
    throw e;
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

  private notify(...args: Parameters<typeof this.onChange>): void {
    try {
      this.onChange(...args);
    } catch {
      console.warn("Switcher onChange listener failed");
    }
  }

  private async drain(): Promise<void> {
    try {
      while (this.pending) {
        const job = this.pending;
        this.pending = null;
        this.target = job.accountId;
        this.notify(job.accountId);
        let result: SwitchResult;
        try {
          result = await this.run(job.accountId);
        } catch (e) {
          result = { status: "error", accountId: job.accountId, message: message(e) };
        }
        this.target = null;
        job.resolve(result);
        this.notify(null, result);
      }
    } finally {
      this.running = null;
    }
  }

  private async run(accountId: string): Promise<SwitchResult> {
    const { jar, store, api, tabs, now } = this.deps;
    const target = await store.get(accountId);
    if (!target) return { status: "error", accountId, message: "Unknown account" };
    if (!hasLiveSession(target.cookies, now())) {
      await store.setStatus(accountId, "signedOut");
      return { status: "signedOut", accountId };
    }

    const previous = await saveCurrentSession(this.deps);
    if (previous.savedTo === accountId) {
      await store.setActive(accountId);
      return { status: "switched", accountId, reloadedTabs: 0 };
    }

    /** Puts the previous cookie set back; reports whether that worked instead of throwing. */
    const rollback = async (): Promise<boolean> => {
      try {
        await jar.clear();
        await jar.restore(previous.cookies, now());
        return true;
      } catch {
        console.warn("Could not restore the previous claude.ai session");
        return false;
      }
    };
    const failure = (text: string, restored: boolean): SwitchResult => ({
      status: "error",
      accountId,
      message: restored ? text : `${text} (restoring the previous session also failed)`,
    });

    try {
      await jar.clear();
      await jar.restore(target.cookies, now());
    } catch (e) {
      return failure(message(e), await rollback());
    }

    let identity: Identity;
    try {
      identity = await api.whoAmI(target.orgUuid);
    } catch (e) {
      const restored = await rollback();
      if (e instanceof AuthError) {
        await store.setStatus(accountId, "signedOut");
        return { status: "signedOut", accountId };
      }
      return failure(message(e), restored);
    }
    if (identity.accountUuid !== accountId) {
      return failure(`The saved session belongs to ${identity.email}`, await rollback());
    }

    try {
      await store.setCookies(accountId, await jar.snapshot(), now());
      await store.setActive(accountId);
    } catch (e) {
      return failure(message(e), await rollback());
    }
    // The switch is committed; a reload problem must not undo it.
    const reloadedTabs = await tabs.reloadClaudeTabs().catch(() => 0);
    return { status: "switched", accountId, reloadedTabs };
  }
}
