import { CLAUDE_ORIGIN } from "./env";
import type { ResourceKind } from "./types";

export interface ResourceRef {
  kind: ResourceKind;
  id: string;
  key: string; // `${kind}:${id}`
}

const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
/** `uuid`: the id is a UUID, which is case-insensitive — lowercased so one chat or project has one key. */
const ROUTES: { kind: ResourceKind; re: RegExp; uuid?: true }[] = [
  { kind: "codeArtifact", re: /^\/code\/artifact\/([A-Za-z0-9_-]+)\/?$/ },
  { kind: "artifact", re: /^\/artifact\/([A-Za-z0-9_-]+)\/?$/ },
  { kind: "chat", re: new RegExp(`^/chat/(${UUID})/?$`), uuid: true },
  { kind: "project", re: new RegExp(`^/project/(${UUID})/?$`), uuid: true },
];

/** claude.ai pages that can be "not found" because they belong to another account. */
export function parseResourceUrl(url: string): ResourceRef | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.origin !== CLAUDE_ORIGIN) return null;
  for (const { kind, re, uuid } of ROUTES) {
    const m = re.exec(u.pathname);
    if (!m?.[1]) continue;
    const id = uuid ? m[1].toLowerCase() : m[1];
    return { kind, id, key: `${kind}:${id}` };
  }
  return null;
}
