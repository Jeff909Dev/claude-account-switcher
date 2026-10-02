import type { Request } from "../shared/messages";
import { esc } from "../shared/html";
import type { RescueInfo, UiState } from "../shared/types";

export interface BannerView {
  show(info: RescueInfo): void;
  setState(state: UiState): void;
  hide(): void;
  readonly element: HTMLElement;
}

export function createBanner(root: ShadowRoot, doc: Document, send: (req: Request) => Promise<unknown>): BannerView {
  const el = doc.createElement("div");
  el.className = "banner";
  el.hidden = true;
  el.setAttribute("role", "alert");
  root.appendChild(el);
  let info: RescueInfo | null = null;
  let state: UiState | null = null;
  let switching = false;
  let error: string | null = null;

  const draw = () => {
    if (!info || !state) {
      el.hidden = true;
      return;
    }
    const i = info;
    el.hidden = false;
    if (switching) {
      el.innerHTML = `<div class="title"><span>Switching…</span></div>`;
      return;
    }
    const current = state.accounts.find((a) => a.id === i.currentAccountId);
    const where = current ? `${esc(current.label)} <span class="muted">(${esc(current.email)})</span>` : "this account";
    const remembered = i.candidates.find((a) => a.id === i.rememberedAccountId);
    const buttons = i.candidates
      .map((a) => {
        const signedOut = a.status === "signedOut";
        const primary = a.id === i.rememberedAccountId;
        return `<button class="btn${primary ? " primary" : ""}" data-action="openAs" data-id="${esc(a.id)}"${signedOut ? " disabled" : ""}>Open as ${esc(a.label)}${signedOut ? " · signed out" : ""}</button>`;
      })
      .join("");
    const extra = i.candidates.length === 0 ? `<button class="btn" data-action="add">+ Add another account</button>` : "";
    el.innerHTML = `<div class="title"><span>This isn't in ${where}</span><button class="close" data-action="close" aria-label="Dismiss">×</button></div>${remembered ? `<div class="muted">Last opened as ${esc(remembered.label)}</div>` : ""}${error ? `<div class="err" role="alert">${esc(error)}</div>` : ""}<div class="actions">${buttons}${extra}</div>`;
  };

  const fail = (e: unknown) => {
    error = e instanceof Error ? e.message : String(e);
    draw();
  };

  el.addEventListener("click", (e) => {
    const t = (e.target as Element).closest<HTMLElement>("[data-action]");
    if (!t || (t instanceof HTMLButtonElement && t.disabled) || !info) return;
    const resourceKey = info.resourceKey;
    switch (t.dataset.action) {
      case "close":
        info = null;
        switching = false;
        draw();
        break;
      case "add":
        error = null;
        void send({ type: "addAccount:start" }).catch((e: unknown) => fail(e));
        break;
      case "openAs":
        error = null;
        switching = true;
        draw();
        void send({ type: "rescue:openAs", accountId: t.dataset.id ?? "", resourceKey }).catch((e: unknown) => {
          switching = false;
          fail(e);
        });
        break;
    }
  });

  return {
    show(next) {
      info = next;
      switching = false;
      error = null;
      draw();
    },
    setState(next) {
      state = next;
      draw();
    },
    hide() {
      info = null;
      draw();
    },
    element: el,
  };
}
