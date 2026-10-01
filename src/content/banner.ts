import type { Request } from "../shared/messages";
import { esc } from "../shared/html";
import type { ProbeResult, RescueInfo, UiState } from "../shared/types";

export interface BannerView {
  show(info: RescueInfo): void;
  setState(state: UiState): void;
  hide(): void;
  readonly element: HTMLElement;
}

const MARK: Record<ProbeResult["outcome"], string> = {
  found: `<span class="found">✓ found</span>`,
  notFound: `<span class="notfound">✗ not found</span>`,
  signedOut: `<span class="notfound">– signed out</span>`,
  error: `<span class="err">! error</span>`,
};

export function createBanner(root: ShadowRoot, doc: Document, send: (req: Request) => Promise<unknown>): BannerView {
  const el = doc.createElement("div");
  el.className = "banner";
  el.hidden = true;
  el.setAttribute("role", "alert");
  root.appendChild(el);
  let info: RescueInfo | null = null;
  let state: UiState | null = null;
  let results: ProbeResult[] | null = null;
  let probing = false;
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
    const outcome = (id: string) => results?.find((r) => r.accountId === id)?.outcome;
    const buttons = i.candidates
      .map((a) => {
        const o = outcome(a.id);
        const disabled = a.status === "signedOut" || o === "notFound" || o === "signedOut";
        const primary = o === "found" || (!results && a.id === i.rememberedAccountId);
        return `<button class="btn${primary ? " primary" : ""}" data-action="openAs" data-id="${esc(a.id)}"${disabled ? " disabled" : ""}>Open as ${esc(a.label)}${a.status === "signedOut" ? " · signed out" : ""}</button>`;
      })
      .join("");
    const extra =
      i.candidates.length === 0
        ? `<button class="btn" data-action="add">+ Add another account</button>`
        : state.prefs.rescueProbe && !results
          ? `<button class="btn" data-action="probe"${probing ? " disabled" : ""}>${probing ? "Checking…" : "Find in my accounts"}</button>`
          : "";
    const list = results
      ? `<ul class="results">${results.map((r) => `<li>${esc(i.candidates.find((c) => c.id === r.accountId)?.label ?? r.accountId)} … ${MARK[r.outcome]}</li>`).join("")}</ul>`
      : "";
    el.innerHTML = `<div class="title"><span>This isn't in ${where}</span><button class="close" data-action="close" aria-label="Dismiss">×</button></div>${remembered ? `<div class="muted">Last opened as ${esc(remembered.label)}</div>` : ""}${list}${error ? `<div class="err" role="alert">${esc(error)}</div>` : ""}<div class="actions">${buttons}${extra}</div>`;
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
      case "probe":
        probing = true;
        error = null;
        draw();
        void send({ type: "rescue:probe", resourceKey })
          .then((r) => {
            results = Array.isArray(r) ? (r as ProbeResult[]) : [];
          })
          .catch((e: unknown) => {
            error = e instanceof Error ? e.message : String(e);
          })
          .finally(() => {
            probing = false;
            draw();
          });
        break;
    }
  });

  return {
    show(next) {
      if (info?.resourceKey !== next.resourceKey) results = null;
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
