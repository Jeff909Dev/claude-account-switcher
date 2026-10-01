import { accountRowParts, avatarHtml, esc } from "../shared/html";
import type { PublicAccount, UiState } from "../shared/types";
import { formatAge, levelOf, resetTitle } from "../shared/usageFormat";

export type Screen = "list" | "manage" | "addIntro";
export interface ViewState {
  screen: Screen;
  confirmRemoveId: string | null;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const labelOf = (s: UiState, id: string | null) => s.accounts.find((a) => a.id === id)?.label ?? "account";
const head = (title: string, back = false) =>
  `<header class="head">${back ? `<button class="btn ghost back" data-action="back" aria-label="Back">‹</button>` : ""}<span class="title">${esc(title)}</span></header>`;

export function usageLine(a: PublicAccount, s: UiState, now: number): string {
  const snap = s.usage[a.id];
  if (!snap || snap.limits.length === 0) return "";
  const active = a.id === s.activeId;
  const items = snap.limits
    .slice(0, 3)
    .map((l) => {
      const p = Math.round(l.percent);
      return `<span class="u ${levelOf(l.percent)}"><span class="ul">${esc(l.label)}</span> <span class="num">${p}%</span><span class="ubar"><i style="width:${p}%"></i></span></span>`;
    })
    .join(`<span class="dot"> · </span>`);
  const asOf = active ? "" : `<span class="asof"> · as of ${esc(formatAge(now - snap.fetchedAt))}</span>`;
  return `<span class="usage${active ? "" : " stale"}" title="${esc(resetTitle(snap.limits, now))}">${items}${asOf}</span>`;
}

function row(a: PublicAccount, i: number, s: UiState, now: number): string {
  const active = a.id === s.activeId;
  const signedOut = a.status === "signedOut";
  const { sub, right } = accountRowParts(a, i, s);
  return `<button class="row${active ? " active" : ""}" data-action="${signedOut ? "signin" : "switch"}" data-id="${esc(a.id)}">${avatarHtml(a.label, a.color)}<span class="who"><span class="label">${esc(a.label)}</span>${sub}</span><span class="badge">${esc(a.plan)}</span>${right}${signedOut ? "" : usageLine(a, s, now)}</button>`;
}

function renderList(s: UiState, now: number): string {
  const top = `<header class="head"><span class="title"><span class="claude">✻</span> Claude accounts</span><span class="kbd" title="Open this popup">⌥⇧A</span></header>`;
  const status = s.switchingTo
    ? `<div class="status"><span class="spinner"></span> Switching to ${esc(labelOf(s, s.switchingTo))}…</div>`
    : s.lastSwitch && now - s.lastSwitch.at < 10_000
      ? `<div class="status muted">${s.lastSwitch.reloadedTabs > 0 ? `Reloaded ${plural(s.lastSwitch.reloadedTabs, "claude.ai tab")}` : "Switched"}</div>`
      : "";
  const body = s.accounts.length
    ? `<div class="list">${s.accounts.map((a, i) => row(a, i, s, now)).join("")}</div>`
    : `<div class="empty"><p>No accounts yet.</p><p class="muted">+ Add account first saves the claude.ai account you're signed into, then opens claude.ai signed out so you can sign in to another.</p></div>`;
  const foot = `<footer class="foot"><button class="btn ghost" data-action="addIntro">+ Add account</button><button class="btn ghost" data-action="manage">Manage</button><span class="muted count">${plural(s.accounts.length, "account")}</span></footer>`;
  return top + status + body + foot;
}

function renderAddIntro(): string {
  return `${head("Add account", true)}<div class="pane"><p>First we save the claude.ai account you're signed into (if any). Then claude.ai opens signed out, so you can sign in to another account with Google or email.</p><p class="muted">Open the email magic link in this Chrome profile.</p><button class="btn primary block" data-action="addStart">Open claude.ai login</button></div>`;
}

function renderAdd(s: UiState): string {
  const a = s.add;
  const target = s.accounts.find((x) => x.id === a.targetAccountId);
  switch (a.phase) {
    case "waitingLogin": {
      const hint = a.message
        ? `<p class="err">${esc(a.message)}</p>`
        : `<p class="muted">Google or email magic link, in the claude.ai tab we opened. It gives up after 15 minutes.</p>`;
      return `${head("Add account")}<div class="pane"><p><span class="spinner"></span> Waiting for you to sign in${target ? ` as ${esc(target.email)}` : ""}…</p>${hint}<button class="btn block" data-action="addCancel">Cancel</button></div>`;
    }
    case "saved": {
      const acct = s.accounts.find((x) => x.id === a.savedAccountId);
      return `${head("Account saved")}<div class="pane"><p class="ok">✓ ${a.isNew ? "Saved" : "Updated"} ${esc(acct?.email ?? "")} · ${esc(acct?.plan ?? "")}</p><label class="field"><span class="muted">Label</span><input class="input" id="label" maxlength="32" value="${esc(acct?.label ?? "")}"></label><button class="btn primary block" data-action="addDone" data-id="${esc(a.savedAccountId ?? "")}">Done</button></div>`;
    }
    case "mismatch":
      return `${head("Different account")}<div class="pane"><p>You signed in as ${esc(a.mismatchEmail ?? "")}, not ${esc(target?.email ?? "the account you picked")}.</p><button class="btn primary block" data-action="mismatchAdd">Add ${esc(a.mismatchEmail ?? "")} as a new account</button><button class="btn block" data-action="mismatchCancel">Cancel</button></div>`;
    case "error":
      return `${head("Something went wrong")}<div class="pane"><p class="err">${esc(a.message ?? "")}</p><button class="btn block" data-action="addDismiss">Close</button></div>`;
    default:
      return "";
  }
}

function renderManage(s: UiState, v: ViewState): string {
  const rows = s.accounts
    .map((a, i) => {
      const isActive = a.id === s.activeId;
      return `<div class="mrow"><button class="avatar-btn" data-action="color" data-id="${esc(a.id)}" title="Change colour">${avatarHtml(a.label, a.color)}</button><input class="input slim" data-action="rename" data-id="${esc(a.id)}" value="${esc(a.label)}" maxlength="32" aria-label="Label for ${esc(a.email)}"><button class="btn ghost icon" data-action="up" data-id="${esc(a.id)}" aria-label="Move up"${i === 0 ? " disabled" : ""}>↑</button><button class="btn ghost icon" data-action="down" data-id="${esc(a.id)}" aria-label="Move down"${i === s.accounts.length - 1 ? " disabled" : ""}>↓</button><button class="btn ghost danger" data-action="remove" data-id="${esc(a.id)}"${isActive ? ' disabled title="Switch to another account first"' : ""}>${v.confirmRemoveId === a.id ? "Confirm" : "Remove"}</button></div>`;
    })
    .join("");
  // [stored value, shown text]
  const seg = (pref: "theme" | "style", options: [string, string][], current: string) =>
    `<div class="seg" role="group" aria-label="${pref}">${options.map(([value, text]) => `<button data-action="pref" data-pref="${pref}" data-value="${value}" aria-pressed="${value === current}">${text}</button>`).join("")}</div>`;
  const toggle = (pref: "inPageSwitcher" | "badge" | "rescueProbe", label: string) =>
    `<div class="prefrow"><span>${label}</span><button class="switch" role="switch" data-action="toggle" data-pref="${pref}" aria-checked="${s.prefs[pref]}" aria-label="${label}"></button></div>`;
  return `${head("Manage", true)}<div class="pane">${rows || `<p class="muted">No accounts yet.</p>`}</div><hr class="divider"><div class="pane prefs"><div class="prefrow"><span>Theme</span>${seg("theme", [["system", "system"], ["dark", "dark"], ["light", "light"]], s.prefs.theme)}</div><div class="prefrow"><span>Style</span>${seg("style", [["app", "Claude"], ["cli", "CLI"]], s.prefs.style)}</div>${toggle("inPageSwitcher", "Switcher on claude.ai")}${toggle("badge", "Usage badge on the toolbar icon")}${toggle("rescueProbe", "Find links in my accounts (experimental)")}<p class="muted note">Saved sessions are stored unencrypted in this Chrome profile. Removing an account only forgets it here; it doesn't log you out.</p></div>`;
}

/** A failed request or the background's last error, shown under the header of whichever screen is up. */
const withBanner = (html: string, error: string | null) =>
  error ? html.replace("</header>", () => `</header><div class="error" role="alert">${esc(error)}</div>`) : html;

export function render(s: UiState, v: ViewState, now: number, localError: string | null = null): string {
  const err = localError ?? s.error;
  if (s.add.phase !== "idle") return withBanner(renderAdd(s), err);
  if (v.screen === "addIntro") return withBanner(renderAddIntro(), err);
  if (v.screen === "manage") return withBanner(renderManage(s, v), err);
  return withBanner(renderList(s, now), err);
}
