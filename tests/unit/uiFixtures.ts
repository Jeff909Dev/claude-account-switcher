import type { PublicAccount, UiState } from "../../src/shared/types";

export const NOW = Date.parse("2026-10-01T20:00:00Z");

export const acct = (id: string, label: string, extra: Partial<PublicAccount> = {}): PublicAccount => ({
  id, email: `${label.toLowerCase()}@example.com`, name: label, label, color: 0, plan: "Pro", orgUuid: `org-${id}`, savedAt: 0, status: "ok", ...extra,
});

export const idleAdd: UiState["add"] = { phase: "idle", targetAccountId: null, savedAccountId: null, isNew: false, mismatchEmail: null, message: null };

export const ui = (over: Partial<UiState> = {}): UiState => ({
  accounts: [acct("a", "Acme", { plan: "Max 20x" }), acct("b", "Personal", { color: 1 }), acct("c", "Lab", { status: "signedOut" })],
  activeId: "a",
  prefs: { theme: "system", style: "app", inPageSwitcher: true, badge: true, rescueProbe: false },
  switchingTo: null,
  lastSwitch: null,
  add: idleAdd,
  usage: {
    a: { fetchedAt: NOW - 10_000, limits: [
      { kind: "session", label: "5h", percent: 25, resetsAt: "2026-10-01T22:30:00Z" },
      { kind: "weekly_all", label: "week", percent: 54, resetsAt: "2026-10-06T04:00:00Z" },
      { kind: "weekly_scoped", label: "Fable", percent: 64, resetsAt: "2026-10-06T04:00:00Z" },
    ] },
    b: { fetchedAt: NOW - 2 * 3_600_000, limits: [{ kind: "session", label: "5h", percent: 92, resetsAt: null }] },
  },
  error: null,
  ...over,
});
