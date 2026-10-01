const NON_TEXT_INPUTS = new Set(["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "image"]);

export function isEditable(el: Element | null): boolean {
  if (!el) return false;
  if ((el as HTMLElement).isContentEditable) return true;
  if (el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true;
  if (el.tagName === "INPUT") return !NON_TEXT_INPUTS.has((el as HTMLInputElement).type);
  return el.closest('[contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]') !== null;
}

/** ⌥1–9 → 1..9, but never while typing: on a Spanish Mac keyboard ⌥1 "|", ⌥2 "@", ⌥3 "#". */
export function digitShortcut(
  e: Pick<KeyboardEvent, "altKey" | "shiftKey" | "metaKey" | "ctrlKey" | "code"> & { repeat?: boolean; isComposing?: boolean },
  active: Element | null,
): number | null {
  if (!e.altKey || e.shiftKey || e.metaKey || e.ctrlKey || e.repeat || e.isComposing) return null; // a held key must not spam switches
  const m = /^Digit([1-9])$/.exec(e.code);
  if (!m || isEditable(active)) return null;
  return Number(m[1]);
}

export function installKeys(
  win: Window,
  getAccounts: () => { id: string; status?: string }[],
  onSwitch: (accountId: string) => void,
): () => void {
  const onKey = (e: KeyboardEvent) => {
    const n = digitShortcut(e, win.document.activeElement);
    if (n === null) return;
    const account = getAccounts()[n - 1];
    if (!account || account.status === "signedOut") return;
    e.preventDefault();
    e.stopPropagation();
    onSwitch(account.id);
  };
  win.addEventListener("keydown", onKey, true);
  return () => win.removeEventListener("keydown", onKey, true);
}
