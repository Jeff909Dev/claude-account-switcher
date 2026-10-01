export type SameSite = "no_restriction" | "lax" | "strict" | "unspecified";

export interface StoredCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite: SameSite;
  hostOnly: boolean;
  expirationDate?: number; // seconds since epoch; absent = session cookie
}

export interface Identity {
  accountUuid: string;
  email: string;
  name: string;
  orgUuid: string;
  orgName: string;
  plan: string; // "Max 20x" | "Max 5x" | "Max" | "Pro" | "Team" | "Enterprise" | "Free"
}

export type AccountStatus = "ok" | "signedOut";

export interface Account {
  id: string; // accountUuid
  email: string;
  name: string;
  label: string;
  color: number; // index into ACCOUNT_COLORS
  plan: string;
  orgUuid: string;
  cookies: StoredCookie[];
  savedAt: number; // ms
  status: AccountStatus;
}

export type PublicAccount = Omit<Account, "cookies">;

export interface Prefs {
  theme: "system" | "dark" | "light";
  style: "app" | "cli";
  inPageSwitcher: boolean;
  badge: boolean;
  rescueProbe: boolean;
}

export interface RememberedResource {
  accountId: string; // the account it was last opened as
  at: number; // ms; only the most recent ones are kept
}

export interface StoreState {
  version: 1;
  accounts: Record<string, Account>;
  order: string[];
  activeId: string | null;
  resourceMap: Record<string, RememberedResource>; // resourceKey -> where it was last opened
  prefs: Prefs;
}

export interface UsageLimit {
  kind: string; // "session" | "weekly_all" | "weekly_scoped" | other
  label: string; // "5h" | "week" | model name e.g. "Fable"
  percent: number; // 0..100
  resetsAt: string | null; // ISO date
}

export interface UsageSnapshot {
  limits: UsageLimit[];
  fetchedAt: number; // ms
}

export type AddPhase = "idle" | "waitingLogin" | "saved" | "mismatch" | "error";

export interface AddFlowPublic {
  phase: AddPhase;
  targetAccountId: string | null;
  savedAccountId: string | null;
  isNew: boolean;
  mismatchEmail: string | null;
  message: string | null;
}

export interface UiState {
  accounts: PublicAccount[]; // in display order
  activeId: string | null;
  prefs: Prefs;
  switchingTo: string | null;
  lastSwitch: { accountId: string; reloadedTabs: number; at: number } | null;
  add: AddFlowPublic;
  usage: Record<string, UsageSnapshot>;
  error: string | null;
}

export type ResourceKind = "artifact" | "chat" | "project" | "codeArtifact";

export interface ProbeResult {
  accountId: string;
  outcome: "found" | "notFound" | "signedOut" | "error";
}

export interface RescueInfo {
  resourceKey: string;
  kind: ResourceKind;
  currentAccountId: string | null;
  candidates: PublicAccount[]; // other accounts, remembered one first
  rememberedAccountId: string | null;
}

export const ACCOUNT_COLORS = ["#c96442", "#7d8b4e", "#5b7aa6", "#8e5a8a", "#b0893e", "#4f8f87"] as const;
