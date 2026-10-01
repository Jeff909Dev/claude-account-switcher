import type { Push, Request } from "../shared/messages";
import type { RescueInfo, UiState } from "../shared/types";
import { createBanner } from "./banner";
import { HOST_ID, ensureHost } from "./host";
import { installKeys } from "./keys";
import { createSwitcher } from "./switcherUi";

export interface BootDeps {
  doc: Document;
  win: Window;
  send: (req: Request) => Promise<unknown>;
  onMessage: (cb: (msg: unknown) => void) => void;
  /** Waits before each getState retry; the service worker may still be waking up. */
  retryDelaysMs?: number[];
  /** Debounce for the remount check. */
  settleMs?: number;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function boot(deps: BootDeps): Promise<{ destroy(): void }> {
  const { doc, win, send } = deps;
  const delays = deps.retryDelaysMs ?? [250, 1000, 3000];

  // Listen from the very start: pushes that land while getState is pending are kept, not lost.
  let ui: { apply(state: UiState): void; rescue(info: RescueInfo): void } | null = null;
  let pendingState: UiState | null = null;
  let pendingRescue: RescueInfo | null = null;
  deps.onMessage((msg) => {
    const push = msg as Push | undefined;
    if (push?.type === "state") {
      if (ui) ui.apply(push.state);
      else pendingState = push.state;
    } else if (push?.type === "rescue:show") {
      if (ui) ui.rescue(push.rescue);
      else pendingRescue = push.rescue;
    }
  });

  let fetched: UiState | null = null;
  for (let attempt = 0; attempt <= delays.length && !fetched && !pendingState; attempt++) {
    if (attempt > 0) await sleep(delays[attempt - 1] ?? 0);
    fetched = (await send({ type: "getState" }).catch(() => null)) as UiState | null;
  }
  let state: UiState | null = pendingState ?? fetched;

  doc.getElementById(HOST_ID)?.remove(); // left behind by an earlier injection (extension reload)
  const root = ensureHost(doc);
  const switcher = createSwitcher(root, doc, send);
  const banner = createBanner(root, doc, send);
  const apply = (next: UiState) => {
    state = next;
    switcher.update(next);
    banner.setState(next);
  };
  ui = { apply, rescue: (info) => banner.show(info) };
  if (state) apply(state);
  else switcher.unavailable("Account switcher unavailable — reload");
  if (pendingState && pendingState !== state) apply(pendingState);
  pendingState = null;

  installKeys(win, () => state?.accounts ?? [], (accountId) =>
    void send({ type: "switch", accountId }).catch(() => console.warn("Could not switch account")),
  );

  // claude.ai's app re-renders and may drop our host: put it back (same shadow root, same handlers).
  let timer: ReturnType<typeof setTimeout> | undefined;
  const observer = new (win as Window & typeof globalThis).MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!root.host.isConnected && !doc.getElementById(HOST_ID)) (doc.body ?? doc.documentElement).appendChild(root.host);
    }, deps.settleMs ?? 300);
  });
  observer.observe(doc.documentElement, { childList: true, subtree: true });

  const rescue = pendingRescue ?? ((await send({ type: "rescue:get" }).catch(() => null)) as RescueInfo | null);
  if (rescue) banner.show(rescue);
  return {
    destroy() {
      observer.disconnect();
      clearTimeout(timer);
    },
  };
}
