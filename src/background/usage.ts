import type { UsageLimit, UsageSnapshot } from "../shared/types";
import { levelOf } from "../shared/usageFormat";
import { orderedAccounts, type AccountStore } from "./accounts";
import { createSerialQueue } from "./serial";

export const USAGE_KEY = "cas:usage";
export const USAGE_ALARM = "cas:usage-refresh";
export const USAGE_PERIOD_MIN = 15;
export const USAGE_MAX_AGE_MS = 60_000;
export const BADGE_WARN = "#e5a83b";
export const BADGE_CRIT = "#ff6b80";

const KNOWN_MODELS = ["fable", "opus", "sonnet", "haiku"];
const RANK: Record<string, number> = { session: 0, weekly_all: 1 };

const pct = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const obj = (v: unknown): Record<string, unknown> | null => (v !== null && typeof v === "object" ? (v as Record<string, unknown>) : null);
const sortLimits = (l: UsageLimit[]) => [...l].sort((a, b) => (RANK[a.kind] ?? 2) - (RANK[b.kind] ?? 2));

/** Tolerant: `limits[]` when present and usable, else five_hour / seven_day / seven_day_<known model>. */
export function parseUsage(json: unknown): UsageLimit[] {
  const o = obj(json);
  if (!o) return [];
  if (Array.isArray(o.limits)) {
    const out: UsageLimit[] = [];
    for (const raw of o.limits) {
      const r = obj(raw);
      const percent = pct(r?.percent);
      if (!r || percent === null) continue;
      const kind = str(r.kind) ?? "unknown";
      const model = str(obj(obj(r.scope)?.model)?.display_name);
      const label = kind === "session" ? "5h" : kind === "weekly_all" ? "week" : model;
      if (!label) continue;
      out.push({ kind, label, percent, resetsAt: str(r.resets_at) });
    }
    if (out.length > 0) return sortLimits(out);
  }
  const out: UsageLimit[] = [];
  const windowLimit = (key: string, kind: string, label: string) => {
    const w = obj(o[key]);
    const percent = pct(w?.utilization);
    if (w && percent !== null) out.push({ kind, label, percent, resetsAt: str(w.resets_at) });
  };
  windowLimit("five_hour", "session", "5h");
  windowLimit("seven_day", "weekly_all", "week");
  for (const m of KNOWN_MODELS) windowLimit(`seven_day_${m}`, "weekly_scoped", m.charAt(0).toUpperCase() + m.slice(1));
  return sortLimits(out);
}

export function badgeFor(snapshot: UsageSnapshot | undefined, enabled: boolean): { text: string; color: string | null } {
  if (!enabled || !snapshot || snapshot.limits.length === 0) return { text: "", color: null };
  const max = Math.max(...snapshot.limits.map((l) => l.percent));
  const level = levelOf(max);
  if (level === "ok") return { text: "", color: null };
  return { text: `${Math.round(max)}%`, color: level === "crit" ? BADGE_CRIT : BADGE_WARN };
}

export interface UsageDeps {
  store: AccountStore;
  area: chrome.storage.StorageArea;
  fetchUsage(orgUuid: string): Promise<unknown>;
  now(): number;
  setBadge(text: string, color: string | null): Promise<void>;
}

export class UsageService {
  private readonly serial = createSerialQueue();

  constructor(private readonly deps: UsageDeps) {}

  async all(): Promise<Record<string, UsageSnapshot>> {
    const got = await this.deps.area.get(USAGE_KEY);
    return (got[USAGE_KEY] as Record<string, UsageSnapshot> | undefined) ?? {};
  }

  /** Fetches the active account's usage unless its snapshot is younger than `maxAgeMs`. Serialized. */
  refreshActive(maxAgeMs = 0): Promise<boolean> {
    return this.serial(() => this.doRefresh(maxAgeMs));
  }

  /** A removed account's numbers go with it. Serialized with refreshes, so one can't write them back. */
  forget(accountId: string): Promise<void> {
    return this.serial(async () => {
      const all = await this.all();
      if (!(accountId in all)) return;
      delete all[accountId];
      await this.deps.area.set({ [USAGE_KEY]: all });
    });
  }

  async updateBadge(): Promise<void> {
    const s = await this.deps.store.load();
    const all = await this.all();
    const b = badgeFor(s.activeId ? all[s.activeId] : undefined, s.prefs.badge);
    await this.deps.setBadge(b.text, b.color);
  }

  private async doRefresh(maxAgeMs: number): Promise<boolean> {
    const s = await this.deps.store.load();
    const active = s.activeId ? s.accounts[s.activeId] : undefined;
    if (!active || active.status !== "ok" || !active.orgUuid) return false;
    const all = await this.all();
    const prev = all[active.id];
    if (prev && this.deps.now() - prev.fetchedAt < maxAgeMs) return false;
    let limits: UsageLimit[];
    try {
      limits = parseUsage(await this.deps.fetchUsage(active.orgUuid));
    } catch {
      return false; // offline, auth or a non-JSON body: keep the last snapshot
    }
    if (limits.length === 0) return false; // unusable body: never replace a snapshot with nothing
    const next: Record<string, UsageSnapshot> = {};
    for (const { id } of orderedAccounts(s)) {
      const snap = all[id];
      if (snap) next[id] = snap;
    }
    next[active.id] = { limits, fetchedAt: this.deps.now() };
    await this.deps.area.set({ [USAGE_KEY]: next });
    await this.updateBadge();
    return true;
  }
}
