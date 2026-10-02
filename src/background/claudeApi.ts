/**
 * Every assumption about claude.ai's network surface lives here.
 * After running docs/notes/spike.md, update this file and tests/fixtures — nothing else.
 */
import { CLAUDE_HOST, CLAUDE_ORIGIN } from "../shared/env";
import type { Identity } from "../shared/types";

export const SESSION_COOKIE = "sessionKey";
/** The organization claude.ai has selected for this login (multi-org accounts). */
export const ORG_COOKIE = "lastActiveOrg";
export const IDENTITY_PATH = "/api/bootstrap";
export const LOGIN_PATH = "/login";
/** Browser-bound Cloudflare cookies: never saved, cleared or restored. */
export const PRESERVED_COOKIES: ReadonlySet<string> = new Set(["__cf_bm", "cf_clearance", "_cfuvid"]);

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
const defaultFetch: FetchLike = (input, init) => fetch(input, init);

export class AuthError extends Error {
  constructor(readonly status: number) {
    super(`claude.ai answered ${status}`);
    this.name = "AuthError";
  }
}

export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetworkError";
  }
}

const str = (v: unknown): string | undefined => (typeof v === "string" && v.length > 0 ? v : undefined);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

export function planLabel(org: { capabilities?: string[]; rateLimitTier?: string | null }): string {
  const tier = org.rateLimitTier ?? "";
  const caps = org.capabilities ?? [];
  if (tier.includes("max_20x")) return "Max 20x";
  if (tier.includes("max_5x")) return "Max 5x";
  if (caps.includes("claude_max")) return "Max";
  if (caps.includes("raven")) return "Team";
  if (caps.includes("enterprise")) return "Enterprise";
  if (caps.includes("claude_pro")) return "Pro";
  return "Free";
}

interface RawOrg {
  uuid?: unknown;
  name?: unknown;
  capabilities?: unknown;
  rate_limit_tier?: unknown;
}

export function parseIdentity(json: unknown, preferredOrgUuid?: string | null): Identity {
  const account = (json as { account?: Record<string, unknown> } | null)?.account;
  const uuid = str(account?.uuid);
  const email = str(account?.email_address);
  if (!uuid || !email) throw new Error("Unexpected identity response: missing account uuid or email");
  const memberships = Array.isArray(account?.memberships) ? (account.memberships as { organization?: RawOrg }[]) : [];
  const orgs = memberships.map((m) => m.organization).filter((o): o is RawOrg => !!o && typeof o.uuid === "string");
  const chatOrgs = orgs.filter((o) => strs(o.capabilities).includes("chat"));
  const pool = chatOrgs.length > 0 ? chatOrgs : orgs;
  const org = pool.find((o) => o.uuid === preferredOrgUuid) ?? pool[0];
  return {
    accountUuid: uuid,
    email,
    name: str(account?.full_name) ?? str(account?.display_name) ?? email,
    orgUuid: str(org?.uuid) ?? "",
    orgName: str(org?.name) ?? "",
    plan: planLabel({ capabilities: strs(org?.capabilities), rateLimitTier: str(org?.rate_limit_tier) ?? null }),
  };
}

async function getJson(fetchImpl: FetchLike, path: string): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchImpl(`${CLAUDE_ORIGIN}${path}`, {
      credentials: "include",
      cache: "no-store",
      headers: { accept: "application/json" },
    });
  } catch (e) {
    throw new NetworkError(e instanceof Error ? e.message : String(e));
  }
  if (res.status === 401 || res.status === 403) throw new AuthError(res.status);
  if (!res.ok) throw new NetworkError(`claude.ai answered ${res.status}`);
  try {
    return await res.json();
  } catch {
    throw new NetworkError("claude.ai answered with a non-JSON body"); // e.g. an HTML challenge page
  }
}

export async function whoAmI(opts: { fetchImpl?: FetchLike; preferredOrgUuid?: string | null } = {}): Promise<Identity> {
  return parseIdentity(await getJson(opts.fetchImpl ?? defaultFetch, IDENTITY_PATH), opts.preferredOrgUuid);
}

export const usagePath = (orgUuid: string): string => `/api/organizations/${encodeURIComponent(orgUuid)}/usage`;

export async function fetchUsageJson(orgUuid: string, fetchImpl: FetchLike = defaultFetch): Promise<unknown> {
  return getJson(fetchImpl, usagePath(orgUuid));
}

/** A claude.ai API call about `resourceId` answered 403/404 → the resource isn't in this account. */
export function isResourceMiss(apiUrl: string, statusCode: number, resourceId: string): boolean {
  if (statusCode !== 403 && statusCode !== 404) return false;
  let u: URL;
  try {
    u = new URL(apiUrl);
  } catch {
    return false;
  }
  // Case-insensitive: the page may show a UUID in another case than the API path uses.
  return u.origin === CLAUDE_ORIGIN && u.pathname.startsWith("/api/") && u.pathname.toLowerCase().includes(resourceId.toLowerCase());
}

export const loginUrl = (): string => `${CLAUDE_ORIGIN}${LOGIN_PATH}`;

export function hostMatchesClaude(cookieDomain: string): boolean {
  const d = cookieDomain.replace(/^\./, "");
  return d === CLAUDE_HOST || CLAUDE_HOST.endsWith(`.${d}`);
}
