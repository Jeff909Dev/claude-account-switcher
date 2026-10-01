import type { Request } from "../shared/messages";
import { accountRowParts, avatarHtml, esc } from "../shared/html";
import type { UiState } from "../shared/types";
import { findAnchor, placement } from "./anchors";

export interface SwitcherView {
  update(state: UiState): void;
  /** The background never answered: show a floating pill that says so, until the next update. */
  unavailable(message: string): void;
  reposition(): void;
  destroy(): void;
  readonly element: HTMLElement;
}

export function createSwitcher(root: ShadowRoot, doc: Document, send: (req: Request) => Promise<unknown> | void): SwitcherView {
  const win = doc.defaultView!;
  const wrap = doc.createElement("div");
  wrap.className = "cas-switch";
  wrap.hidden = true;
  root.appendChild(wrap);
  let state: UiState | null = null;
  let open = false;
  let error: string | null = null;
  let unavailable: string | null = null;

  const reposition = () => {
    const p = placement(findAnchor(doc), { width: win.innerWidth, height: win.innerHeight });
    wrap.dataset.placement = p.mode;
    wrap.style.left = `${p.left}px`;
    wrap.style.top = `${p.top}px`;
  };

  const draw = () => {
    if (unavailable) {
      wrap.hidden = false;
      wrap.innerHTML = `<button class="pill" disabled role="alert"><span>${esc(unavailable)}</span></button>`;
      reposition();
      return;
    }
    if (!state || !state.prefs.inPageSwitcher || state.accounts.length === 0) {
      wrap.hidden = true;
      return;
    }
    wrap.hidden = false;
    const s = state;
    const active = s.accounts.find((a) => a.id === s.activeId);
    const items = s.accounts
      .map((a, i) => {
        const { sub, right } = accountRowParts(a, i, s);
        const action = a.status === "signedOut" ? "signin" : "switch";
        return `<button class="item" role="menuitem" data-action="${action}" data-id="${esc(a.id)}">${avatarHtml(a.label, a.color)}<span><span class="label">${esc(a.label)}</span>${sub}</span>${right}</button>`;
      })
      .join("");
    const failure = error ? `<div class="hint err" role="alert">${esc(error)}</div>` : "";
    wrap.innerHTML = `<button class="pill" data-action="toggle" aria-haspopup="menu" aria-expanded="${open}">${active ? avatarHtml(active.label, active.color) : ""}<span>${esc(active?.label ?? "Accounts")}</span><span aria-hidden="true">▾</span></button><div class="menu" role="menu"${open ? "" : " hidden"}>${items}${failure}<div class="sep"></div><button class="item" data-action="add"><span></span><span>+ Add another account</span><span></span></button><div class="hint">⌥1–9 switch · ⌥⇧A popup</div></div>`;
    reposition();
  };

  const close = () => {
    open = false;
    draw();
  };

  /** Fire a request; a failure reopens the menu with the reason instead of vanishing silently. */
  const run = (req: Request) => {
    error = null;
    new Promise((resolve) => resolve(send(req))) // the executor runs now, so send fires synchronously
      .catch((e: unknown) => {
        error = e instanceof Error ? e.message : String(e);
        open = true;
        draw();
      });
  };

  wrap.addEventListener("click", (e) => {
    const el = (e.target as Element).closest<HTMLElement>("[data-action]");
    if (!el) return;
    const id = el.dataset.id ?? "";
    switch (el.dataset.action) {
      case "toggle":
        open = !open;
        error = null;
        draw();
        break;
      case "switch":
        close();
        run({ type: "switch", accountId: id });
        break;
      case "signin":
        close();
        run({ type: "addAccount:start", targetAccountId: id });
        break;
      case "add":
        close();
        run({ type: "addAccount:start" });
        break;
    }
  });

  const onDocClick = (e: MouseEvent) => {
    if (open && !e.composedPath().includes(wrap)) close();
  };
  const onEsc = (e: KeyboardEvent) => {
    if (open && e.key === "Escape") close();
  };
  doc.addEventListener("click", onDocClick, true);
  doc.addEventListener("keydown", onEsc, true);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const observer = new win.MutationObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(reposition, 300); // claude.ai re-renders a lot; reposition once it settles
  });
  observer.observe(doc.body, { childList: true, subtree: true });
  win.addEventListener("resize", reposition);

  return {
    update(next) {
      state = next;
      unavailable = null;
      draw();
    },
    unavailable(message) {
      unavailable = message;
      open = false;
      draw();
    },
    reposition,
    destroy() {
      observer.disconnect();
      clearTimeout(timer);
      doc.removeEventListener("click", onDocClick, true);
      doc.removeEventListener("keydown", onEsc, true);
      win.removeEventListener("resize", reposition);
      wrap.remove();
    },
    element: wrap,
  };
}
