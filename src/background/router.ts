import { CLAUDE_ORIGIN, CLAUDE_TAB_PATTERN } from "../shared/env";
import type { Push, Reply, Request } from "../shared/messages";
import { parseResourceUrl } from "../shared/resourceKey";
import type { ProbeResult, UiState, UsageSnapshot } from "../shared/types";
import { orderedAccounts, toPublic, type AccountStore } from "./accounts";
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

/** Every Request type, checked against the union so the two can't drift apart. */
const REQUEST_TYPES: Record<Request["type"], true> = {
  getState: true,
  switch: true,
  "addAccount:start": true,
  "addAccount:cancel": true,
  "addAccount:resolveMismatch": true,
  "addAccount:dismiss": true,
  "account:update": true,
  "account:remove": true,
  "account:reorder": true,
  "prefs:update": true,
  "rescue:get": true,
  "rescue:openAs": true,
  "rescue:probe": true,
};

/** Requests a claude.ai page (content script) may send; everything else is for the popup only. */
const PAGE_REQUESTS: ReadonlySet<Request["type"]> = new Set<Request["type"]>([
  "getState",
  "rescue:get",
  "switch",
  "addAccount:start",
  "rescue:openAs",
  "rescue:probe",
]);

/** Who sent a request: the subset of chrome.runtime.MessageSender the router looks at. */
export interface Sender {
  tab?: { id?: number };
  url?: string;
}

/** Content scripts run in claude.ai tabs; the popup is an extension page, even when opened in a tab. */
function fromPage(sender: Sender): boolean {
  return sender.tab !== undefined && !(sender.url ?? "").startsWith(chrome.runtime.getURL(""));
}

export function isRequest(msg: unknown): msg is Request {
  if (typeof msg !== "object" || msg === null) return false;
  const type = (msg as { type?: unknown }).type;
  return typeof type === "string" && Object.hasOwn(REQUEST_TYPES, type);
}

function isClaudeUrl(url: string): boolean {
  try {
    return new URL(url).origin === CLAUDE_ORIGIN;
  } catch {
    return false;
  }
}

export async function buildUiState(deps: RouterDeps): Promise<UiState> {
  const s = await deps.store.load();
  const accounts = orderedAccounts(s).map(toPublic);
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

/**
 * Refreshes the active account's usage once no switch is running and no add flow holds the browser: until then
 * the browser's cookies may belong to a different account than the active one.
 */
export async function refreshUsage(deps: Pick<RouterDeps, "switcher" | "addFlow" | "usage">, maxAgeMs: number): Promise<boolean> {
  await deps.switcher.idle();
  if (await deps.addFlow.isWaiting()) return false;
  return deps.usage.refreshActive(maxAgeMs);
}

export function createRouter(deps: RouterDeps) {
  const ok = <T>(data: T): Reply<T> => ({ ok: true, data });
  const fail = (error: string): Reply<never> => ({ ok: false, error });
  const mutate = async (fn: () => Promise<unknown>): Promise<Reply<null>> => {
    await fn();
    await deps.broadcast();
    return ok(null);
  };
  /** The add flow and the Switcher queue separately: let a running switch finish verifying before the add flow touches cookies. */
  const afterSwitch = async (fn: () => Promise<void>): Promise<void> => {
    await deps.switcher.idle();
    await fn();
  };
  const cancelPendingAdd = async (): Promise<void> => {
    if (await deps.addFlow.isWaiting()) await afterSwitch(() => deps.addFlow.cancel());
  };

  async function route(req: Request, sender: Sender): Promise<Reply> {
    switch (req.type) {
      case "getState": {
        // Only the popup shows usage: refresh when it opens, not on every claude.ai page load.
        if (!fromPage(sender)) {
          void refreshUsage(deps, USAGE_MAX_AGE_MS)
            .then((fetched) => (fetched ? deps.broadcast() : undefined))
            .catch(() => console.warn("Could not refresh usage"));
        }
        return ok(await buildUiState(deps));
      }
      case "switch":
        await cancelPendingAdd();
        void deps.switcher.switchTo(req.accountId); // the background owns the flow; UI follows broadcasts
        return ok(null);
      case "addAccount:start":
        return mutate(() => afterSwitch(() => deps.addFlow.start(req.targetAccountId ?? null)));
      case "addAccount:cancel":
        return mutate(() => afterSwitch(() => deps.addFlow.cancel()));
      case "addAccount:resolveMismatch":
        return mutate(() => afterSwitch(() => deps.addFlow.resolveMismatch(req.addAsNew)));
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
        // Only the resource the sender's page shows. Not the tracked miss: that is lost when the service worker restarts.
        if (parseResourceUrl(sender.url ?? "")?.key !== req.resourceKey) return fail("Nothing to open on this tab");
        await cancelPendingAdd();
        void openAs(deps.store, (id) => deps.switcher.switchTo(id), req.resourceKey, req.accountId).catch(() =>
          console.warn("Open as failed"),
        );
        return ok(null);
      case "rescue:probe": {
        const tabId = sender.tab?.id;
        const miss = tabId === undefined ? undefined : deps.rescue.miss(tabId);
        if (!miss || miss.ref.key !== req.resourceKey) return fail("Nothing to look for on this tab");
        if (!(await deps.store.load()).prefs.rescueProbe) return fail("Find in my accounts is turned off");
        // The probe sends a saved account's cookies to this URL.
        if (!isClaudeUrl(miss.apiUrl)) return fail("Not a claude.ai link");
        return ok(await deps.probe(miss));
      }
      default:
        return fail(`Unknown request ${(req as { type: string }).type}`);
    }
  }

  return async function handle(req: Request, sender: Sender): Promise<Reply> {
    if (fromPage(sender) && !PAGE_REQUESTS.has(req.type)) return fail("Not available from a claude.ai page");
    try {
      return await route(req, sender); // await, so a rejected mutation lands in the catch instead of escaping
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e));
    }
  };
}
