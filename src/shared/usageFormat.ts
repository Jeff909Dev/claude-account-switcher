import type { UsageLimit } from "./types";

export type Level = "ok" | "warn" | "crit";

export function levelOf(percent: number): Level {
  if (percent >= 90) return "crit";
  if (percent >= 70) return "warn";
  return "ok";
}

export function formatAge(ms: number): string {
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const pad = (n: number) => String(n).padStart(2, "0");

export function formatReset(resetsAt: string | null, now: number): string {
  if (!resetsAt) return "";
  const t = Date.parse(resetsAt);
  if (Number.isNaN(t)) return "";
  const diff = t - now;
  if (diff < 24 * 3_600_000) {
    const total = Math.max(0, Math.round(diff / 60_000));
    const h = Math.floor(total / 60);
    const m = total % 60;
    return h > 0 ? `in ${h}h ${m}m` : `in ${m}m`;
  }
  const d = new Date(t);
  return `${DAYS[d.getDay()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function resetTitle(limits: UsageLimit[], now: number): string {
  return limits
    .map((l) => ({ l, when: formatReset(l.resetsAt, now) }))
    .filter((x) => x.when)
    .map((x) => `${x.l.label} resets ${x.when}`)
    .join(" · ");
}
