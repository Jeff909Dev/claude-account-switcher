import type { AddFlowPublic, Identity, StoredCookie } from "../shared/types";
import { SESSION_COOKIE, hostMatchesClaude, loginUrl } from "./claudeApi";
import { hasLiveSession, selectedOrg } from "./cookieJar";
import { createSerialQueue } from "./serial";
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
  /** Why the flow hasn't finished although the browser holds a live login (claude.ai's identity check failed). */
  message?: string;
};
type Mismatch = {
  phase: "mismatch";
  identity: Identity;
  cookies: StoredCookie[];
  targetAccountId: string;
  previousCookies: StoredCookie[];
  previousActiveId: string | null;
  loginTabId: number | null;
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
      return { ...base, targetAccountId: s.targetAccountId, message: s.message ?? null };
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
  private readonly serial = createSerialQueue();

  constructor(
    private readonly deps: AddDeps,
    private readonly onChange: (s: AddFlowPublic) => void = () => {},
  ) {}

  state(): Promise<AddFlowPublic> {
    return this.serial(async () => {
      let s = await this.read();
      if (s.phase === "waitingLogin") {
        // Complete first: a live, verifiable login must never be wiped by the timeout.
        await this.tryComplete(s);
        s = await this.read();
        // Only a sign-in that never happened times out; a live login claude.ai can't verify yet waits for Cancel.
        if (
          s.phase === "waitingLogin" &&
          this.deps.now() - s.startedAt > ADD_FLOW_TIMEOUT_MS &&
          !hasLiveSession(await this.deps.jar.snapshot(), this.deps.now())
        ) {
          await this.cancelNow(s);
          s = await this.read();
        }
      }
      return toPublicAdd(s);
    });
  }

  isWaiting(): Promise<boolean> {
    return this.serial(async () => ["waitingLogin", "mismatch"].includes((await this.read()).phase));
  }

  start(targetAccountId: string | null = null): Promise<void> {
    return this.serial(async () => {
      const current = await this.read();
      if (current.phase === "waitingLogin" || current.phase === "mismatch") return;
      let previous: Awaited<ReturnType<typeof saveCurrentSession>>;
      try {
        previous = await saveCurrentSession(this.deps);
      } catch (e) {
        // The current login could not be verified or saved: clearing cookies now could destroy it.
        await this.write({ phase: "error", message: e instanceof Error ? e.message : String(e) });
        return;
      }
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
      if (addAsNew) await this.saveAndFinish(s.identity, s.cookies, s.loginTabId);
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

  private async read(): Promise<AddFlowInternal> {
    const got = await this.deps.session.get(ADD_FLOW_KEY);
    return (got[ADD_FLOW_KEY] as AddFlowInternal | undefined) ?? { phase: "idle" };
  }

  private async write(s: AddFlowInternal): Promise<void> {
    await this.deps.session.set({ [ADD_FLOW_KEY]: s });
    try {
      this.onChange(toPublicAdd(s));
    } catch {
      console.warn("AddAccountFlow onChange listener failed");
    }
  }

  private async tryComplete(s: Waiting): Promise<void> {
    const cookies = await this.deps.jar.snapshot();
    if (!hasLiveSession(cookies, this.deps.now())) return this.setMessage(s, undefined);
    let identity: Identity;
    try {
      identity = await this.deps.api.whoAmI(selectedOrg(cookies));
    } catch {
      // Not fully signed in yet, or offline: keep waiting, and say so (Cancel restores the previous login).
      return this.setMessage(s, await this.unverifiedMessage(s.previousActiveId));
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
        loginTabId: s.loginTabId,
      });
      return;
    }
    await this.saveAndFinish(identity, fresh, s.loginTabId);
  }

  /** Writes only when the message changes, so repeated checks don't re-broadcast the same state. */
  private async setMessage(s: Waiting, message: string | undefined): Promise<void> {
    if (s.message === message) return;
    const { message: _previous, ...rest } = s;
    await this.write(message === undefined ? rest : { ...rest, message });
  }

  private async unverifiedMessage(previousActiveId: string | null): Promise<string> {
    const previous = previousActiveId === null ? undefined : await this.deps.store.get(previousActiveId);
    const back = previous ? `go back to ${previous.label}` : "go back to being signed out";
    return `Signed in, but claude.ai's identity check failed — reopen this popup to try again, or Cancel to ${back}.`;
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
