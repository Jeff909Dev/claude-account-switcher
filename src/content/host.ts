import { CONTENT_CSS } from "./styles";

/** Set by scripts/build.mjs: "closed" for real builds, "open" only for the e2e build (Playwright can't see closed roots). */
declare const __SHADOW_MODE__: ShadowRootMode | undefined;

export const HOST_ID = "claude-account-switcher-root";
/** Closed, so claude.ai's own (and third-party) scripts can't read other accounts' emails and labels. */
const SHADOW_MODE: ShadowRootMode = typeof __SHADOW_MODE__ === "string" ? __SHADOW_MODE__ : "closed";
/** A closed root isn't reachable through host.shadowRoot: keep the ones this script attached. */
const roots = new WeakMap<Element, ShadowRoot>();

export function ensureHost(doc: Document): ShadowRoot {
  const existing = doc.getElementById(HOST_ID);
  const known = existing ? (roots.get(existing) ?? existing.shadowRoot) : null;
  if (known) return known;
  const host = doc.createElement("div");
  host.id = HOST_ID;
  const root = host.attachShadow({ mode: SHADOW_MODE });
  roots.set(host, root);
  const style = doc.createElement("style");
  style.textContent = CONTENT_CSS;
  root.appendChild(style);
  (doc.body ?? doc.documentElement).appendChild(host);
  return root;
}
