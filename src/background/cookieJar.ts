import { CLAUDE_HOST } from "../shared/env";
import type { SameSite, StoredCookie } from "../shared/types";
import { ORG_COOKIE, PRESERVED_COOKIES, SESSION_COOKIE } from "./claudeApi";

// @types/chrome models some string fields as enums; cast through unknown at the boundary.
const asChrome = <T>(v: unknown): T => v as T;

export function toStored(c: chrome.cookies.Cookie): StoredCookie {
  const s: StoredCookie = {
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path,
    secure: c.secure,
    httpOnly: c.httpOnly,
    sameSite: String(c.sameSite ?? "unspecified") as SameSite,
    hostOnly: c.hostOnly,
  };
  if (c.expirationDate !== undefined) s.expirationDate = c.expirationDate;
  return s;
}

export function cookieUrl(c: Pick<StoredCookie, "domain" | "path" | "secure">): string {
  return `${c.secure ? "https" : "http"}://${c.domain.replace(/^\./, "")}${c.path || "/"}`;
}

export function isExpired(c: StoredCookie, nowMs: number): boolean {
  return c.expirationDate !== undefined && c.expirationDate * 1000 <= nowMs;
}

export function hasLiveSession(cookies: StoredCookie[], nowMs: number): boolean {
  return cookies.some((c) => c.name === SESSION_COOKIE && c.value !== "" && !isExpired(c, nowMs));
}

/** The org claude.ai has selected for this login, so a multi-org account keeps the org in use. */
export function selectedOrg(cookies: StoredCookie[]): string | null {
  return cookies.find((c) => c.name === ORG_COOKIE && c.value !== "")?.value ?? null;
}

async function claudeCookies(): Promise<chrome.cookies.Cookie[]> {
  const all = await chrome.cookies.getAll({ domain: CLAUDE_HOST });
  return all.filter((c) => !PRESERVED_COOKIES.has(c.name));
}

export async function snapshot(): Promise<StoredCookie[]> {
  return (await claudeCookies()).map(toStored);
}

export async function clear(): Promise<number> {
  const doomed = await claudeCookies();
  await Promise.all(
    doomed.map((c) => chrome.cookies.remove({ url: cookieUrl(c), name: c.name, ...(c.storeId ? { storeId: c.storeId } : {}) })),
  );
  return doomed.length;
}

export async function restore(cookies: StoredCookie[], nowMs: number = Date.now()): Promise<number> {
  let restored = 0;
  for (const c of cookies) {
    if (PRESERVED_COOKIES.has(c.name) || isExpired(c, nowMs)) continue;
    const details: chrome.cookies.SetDetails = {
      url: cookieUrl(c),
      name: c.name,
      value: c.value,
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
      sameSite: asChrome<chrome.cookies.SetDetails["sameSite"]>(c.sameSite),
    };
    if (!c.hostOnly) details.domain = c.domain;
    if (c.expirationDate !== undefined) details.expirationDate = c.expirationDate;
    const set = await chrome.cookies.set(details);
    if (!set) throw new Error(`Chrome refused to restore cookie ${c.name}`);
    restored++;
  }
  return restored;
}

export function cookieHeader(cookies: StoredCookie[], nowMs: number = Date.now()): string {
  return cookies
    .filter((c) => !isExpired(c, nowMs))
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}
