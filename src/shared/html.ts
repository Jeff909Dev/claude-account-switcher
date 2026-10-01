import type { PublicAccount, UiState } from "./types";
import { ACCOUNT_COLORS } from "./types";

const ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ENTITIES[c] ?? c);
}

export function avatarHtml(label: string, color: number): string {
  const n = ACCOUNT_COLORS.length;
  const bg = ACCOUNT_COLORS[((color % n) + n) % n];
  const initial = (label.trim().charAt(0) || "?").toUpperCase();
  return `<span class="avatar" style="background:${bg}" aria-hidden="true">${esc(initial)}</span>`;
}

/** The sub line (email, or a sign-in notice) and the right-hand marker (spinner, check, ⌥N hint) of an account row. */
export function accountRowParts(a: PublicAccount, index: number, s: UiState): { sub: string; right: string } {
  const right =
    s.switchingTo === a.id
      ? `<span class="spinner" aria-label="Switching"></span>`
      : a.id === s.activeId
        ? `<span class="check" aria-label="Active">✓</span>`
        : index < 9
          ? `<span class="kbd">⌥${index + 1}</span>`
          : `<span></span>`;
  const sub = a.status === "signedOut" ? `<span class="err">signed out — sign in again</span>` : `<span class="email">${esc(a.email)}</span>`;
  return { sub, right };
}
