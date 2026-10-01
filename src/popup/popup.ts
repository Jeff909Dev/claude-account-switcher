import type { Request } from "../shared/messages";
import type { Prefs, UiState } from "../shared/types";
import { ACCOUNT_COLORS } from "../shared/types";
import { render, type ViewState } from "./view";

export type Send = (req: Request) => Promise<unknown>;

export function applyPrefs(doc: Document, s: UiState): void {
  const html = doc.documentElement;
  if (s.prefs.theme === "system") html.removeAttribute("data-theme");
  else html.setAttribute("data-theme", s.prefs.theme);
  html.setAttribute("data-style", s.prefs.style);
}

const isEditable = (t: EventTarget | null): boolean =>
  t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

export function mount(root: HTMLElement, send: Send, initial: UiState, now: () => number = Date.now) {
  let state = initial;
  let failure: string | null = null; // the last request the background answered with an error
  const view: ViewState = { screen: "list", confirmRemoveId: null };
  const doc = root.ownerDocument;

  let lastHtml: string | null = null;

  /** CSS selector for an element inside root, by what the view gives it (id, or data-action + data attributes). */
  const selectorOf = (el: HTMLElement): string | null => {
    const q = (v: string) => v.replace(/["\\]/g, "\\$&");
    if (el.id) return `#${el.id}`;
    const action = el.dataset.action;
    if (!action) return null;
    return (["id", "pref", "value"] as const).reduce(
      (sel, k) => (el.dataset[k] !== undefined ? `${sel}[data-${k}="${q(el.dataset[k]!)}"]` : sel),
      `[data-action="${q(action)}"]`,
    );
  };

  const draw = () => {
    applyPrefs(doc, state);
    const html = render(state, view, now(), failure);
    if (html === lastHtml) return; // nothing to show: keep the DOM, so typing, focus and caret survive the timer
    const active = doc.activeElement instanceof HTMLElement && root.contains(doc.activeElement) ? doc.activeElement : null;
    const sel = active ? selectorOf(active) : null;
    const typed = active instanceof HTMLInputElement ? { value: active.value, start: active.selectionStart, end: active.selectionEnd } : null;
    root.innerHTML = html;
    lastHtml = html;
    const next = sel ? root.querySelector<HTMLElement>(sel) : null;
    if (!next) return;
    next.focus();
    if (typed && next instanceof HTMLInputElement) {
      next.value = typed.value;
      if (typed.start !== null && typed.end !== null) next.setSelectionRange(typed.start, typed.end);
    }
  };

  /** Sends a request; a failure is shown in the popup rather than lost. Resolves false on failure. */
  const run = async (req: Request): Promise<boolean> => {
    try {
      await send(req);
      if (failure !== null) {
        failure = null;
        draw();
      }
      return true;
    } catch (e) {
      failure = e instanceof Error ? e.message : String(e);
      draw();
      return false;
    }
  };
  const fire = (req: Request) => void run(req);

  root.addEventListener("click", (e) => {
    const el = (e.target as Element | null)?.closest<HTMLElement>("[data-action]");
    if (!el || (el instanceof HTMLButtonElement && el.disabled)) return;
    const id = el.dataset.id ?? "";
    if (el.dataset.action !== "remove" && view.confirmRemoveId !== null) {
      view.confirmRemoveId = null; // Remove always needs its own confirmation
      draw();
    }
    switch (el.dataset.action) {
      case "switch":
        fire({ type: "switch", accountId: id });
        break;
      case "signin":
        fire({ type: "addAccount:start", targetAccountId: id });
        break;
      case "addIntro":
        view.screen = "addIntro";
        draw();
        break;
      case "addStart":
        view.screen = "list";
        fire({ type: "addAccount:start" });
        break;
      case "addCancel":
        fire({ type: "addAccount:cancel" });
        break;
      case "addDone": {
        const label = root.querySelector<HTMLInputElement>("#label")?.value ?? "";
        void run({ type: "account:update", accountId: id, patch: { label } }).then((saved) =>
          saved ? run({ type: "addAccount:dismiss" }) : undefined,
        );
        break;
      }
      case "addDismiss":
        fire({ type: "addAccount:dismiss" });
        break;
      case "mismatchAdd":
        fire({ type: "addAccount:resolveMismatch", addAsNew: true });
        break;
      case "mismatchCancel":
        fire({ type: "addAccount:resolveMismatch", addAsNew: false });
        break;
      case "manage":
        view.screen = "manage";
        draw();
        break;
      case "back":
        view.screen = "list";
        view.confirmRemoveId = null;
        draw();
        break;
      case "color": {
        const a = state.accounts.find((x) => x.id === id);
        if (a) fire({ type: "account:update", accountId: id, patch: { color: (a.color + 1) % ACCOUNT_COLORS.length } });
        break;
      }
      case "up":
      case "down": {
        const order = state.accounts.map((a) => a.id);
        const i = order.indexOf(id);
        const j = el.dataset.action === "up" ? i - 1 : i + 1;
        if (i < 0 || j < 0 || j >= order.length) break;
        [order[i], order[j]] = [order[j]!, order[i]!];
        fire({ type: "account:reorder", order });
        break;
      }
      case "remove":
        if (view.confirmRemoveId === id) {
          view.confirmRemoveId = null;
          fire({ type: "account:remove", accountId: id });
        } else {
          view.confirmRemoveId = id;
          draw();
        }
        break;
      case "pref": {
        const pref = el.dataset.pref as "theme" | "style";
        fire({ type: "prefs:update", patch: { [pref]: el.dataset.value } as Partial<Prefs> });
        break;
      }
      case "toggle": {
        const pref = el.dataset.pref as "inPageSwitcher" | "badge" | "rescueProbe";
        fire({ type: "prefs:update", patch: { [pref]: !state.prefs[pref] } });
        break;
      }
    }
  });

  root.addEventListener("change", (e) => {
    const el = e.target as HTMLInputElement;
    if (el.dataset.action === "rename" && el.dataset.id) fire({ type: "account:update", accountId: el.dataset.id, patch: { label: el.value } });
  });

  doc.addEventListener("keydown", (e) => {
    if (view.screen !== "list" || state.add.phase !== "idle" || e.ctrlKey || e.metaKey || e.altKey || isEditable(e.target)) return;
    const m = /^Digit([1-9])$/.exec(e.code);
    const a = m ? state.accounts[Number(m[1]) - 1] : undefined;
    if (a && a.status === "ok") fire({ type: "switch", accountId: a.id });
  });

  draw();
  return {
    update(next: UiState) {
      state = next;
      draw();
    },
    current: () => state,
    view,
  };
}
