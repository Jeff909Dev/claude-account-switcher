/** claude.ai DOM hooks — update after docs/notes/spike.md (#8). */
export const ANCHOR_SELECTORS = ['[data-testid="user-menu-button"]', 'button[data-testid*="user-menu"]'];

export function findAnchor(doc: Document): Element | null {
  for (const sel of ANCHOR_SELECTORS) {
    const el = doc.querySelector(sel);
    if (el) return el;
  }
  return null;
}

const PILL_HEIGHT = 28;

export function placement(
  anchor: Element | null,
  viewport: { width: number; height: number },
): { mode: "anchored" | "floating"; left: number; top: number } {
  const floating = { mode: "floating" as const, left: 12, top: viewport.height - 12 - PILL_HEIGHT };
  if (!anchor) return floating;
  const r = anchor.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return floating;
  return {
    mode: "anchored",
    left: Math.min(r.right + 6, viewport.width - 40),
    top: Math.max(8, Math.round(r.top + r.height / 2 - PILL_HEIGHT / 2)),
  };
}
