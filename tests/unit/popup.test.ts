// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyPrefs, mount } from "../../src/popup/popup";
import { NOW, acct, ui } from "./uiFixtures";

const addState = (over: Partial<ReturnType<typeof ui>["add"]>) => ({ ...ui().add, ...over });

describe("popup", () => {
  let root: HTMLElement;
  let send: ReturnType<typeof vi.fn<(req: unknown) => Promise<unknown>>>;
  const click = (sel: string) => root.querySelector<HTMLElement>(sel)!.click();

  beforeEach(() => {
    document.body.innerHTML = `<div id="app"></div>`;
    root = document.getElementById("app")!;
    send = vi.fn<(req: unknown) => Promise<unknown>>(async () => null);
  });

  it("lists accounts in order with a check on the active one and Alt+N hints", () => {
    mount(root, send, ui(), () => NOW);
    const rows = [...root.querySelectorAll(".row")];
    expect(rows.map((r) => r.querySelector(".label")!.textContent)).toEqual(["Acme", "Personal", "Lab"]);
    expect(rows[0]!.querySelector(".check")).not.toBeNull();
    expect(rows[1]!.querySelector(".kbd")!.textContent).toBe("⌥2");
    expect(rows[2]!.textContent).toContain("signed out — sign in again");
    expect(root.textContent).toContain("3 accounts");
  });

  it("shows a usage line per row: live for the active one, 'as of' for others", () => {
    mount(root, send, ui(), () => NOW);
    const [a, b] = [...root.querySelectorAll(".row .usage")] as HTMLElement[];
    expect(a!.textContent!.replace(/\s+/g, " ")).toContain("5h 25% · week 54% · Fable 64%");
    expect(a!.title).toMatch(/^5h resets in 2h 30m · week resets [A-Z][a-z]{2} \d{2}:\d{2} · Fable resets /);
    expect(a!.classList.contains("stale")).toBe(false);
    expect(b!.textContent).toContain("as of 2h ago");
    expect(b!.classList.contains("stale")).toBe(true);
    expect(b!.querySelector(".u.crit")).not.toBeNull();
  });

  it("switches on click; a signed-out row starts a targeted sign-in", () => {
    mount(root, send, ui(), () => NOW);
    click('[data-action="switch"][data-id="b"]');
    click('[data-action="signin"][data-id="c"]');
    expect(send).toHaveBeenNthCalledWith(1, { type: "switch", accountId: "b" });
    expect(send).toHaveBeenNthCalledWith(2, { type: "addAccount:start", targetAccountId: "c" });
  });

  it("shows switching and recent-switch status", () => {
    const app = mount(root, send, ui({ switchingTo: "b" }), () => NOW);
    expect(root.querySelector(".status")!.textContent).toContain("Switching to Personal");
    app.update(ui({ lastSwitch: { accountId: "b", reloadedTabs: 2, at: NOW - 1000 } }));
    expect(root.querySelector(".status")!.textContent).toContain("Reloaded 2 claude.ai tabs");
    app.update(ui({ lastSwitch: { accountId: "b", reloadedTabs: 0, at: NOW - 1000 } })); // no claude.ai tab open
    expect(root.querySelector(".status")!.textContent).toBe("Switched");
    app.update(ui({ lastSwitch: { accountId: "b", reloadedTabs: 2, at: NOW - 60_000 } }));
    expect(root.querySelector(".status")).toBeNull();
  });

  it("shows a failed request instead of hanging, and clears it on the next success", async () => {
    send.mockRejectedValueOnce(new Error("Account not found"));
    mount(root, send, ui(), () => NOW);
    click('[data-action="switch"][data-id="b"]');
    await vi.waitFor(() => expect(root.querySelector(".error")!.textContent).toContain("Account not found"));
    click('[data-action="switch"][data-id="b"]');
    await vi.waitFor(() => expect(root.querySelector(".error")).toBeNull());
  });

  it("shows the background's own error banner", () => {
    mount(root, send, ui({ error: "Switch failed" }), () => NOW);
    expect(root.querySelector(".error")!.textContent).toContain("Switch failed");
  });

  it("walks the add flow: intro → start → waiting → saved → done", async () => {
    const app = mount(root, send, ui(), () => NOW);
    click('[data-action="addIntro"]');
    expect(root.textContent).toContain("Open claude.ai login");
    click('[data-action="addStart"]');
    expect(send).toHaveBeenLastCalledWith({ type: "addAccount:start" });
    app.update(ui({ add: addState({ phase: "waitingLogin" }) }));
    click('[data-action="addCancel"]');
    expect(send).toHaveBeenLastCalledWith({ type: "addAccount:cancel" });
    const saved = ui({ add: addState({ phase: "saved", savedAccountId: "b", isNew: true }) });
    app.update(saved);
    expect(root.textContent).toContain("Saved personal@example.com · Pro");
    const input = root.querySelector<HTMLInputElement>("#label")!;
    input.value = "Home";
    app.update(saved);
    expect(root.querySelector<HTMLInputElement>("#label")!.value).toBe("Home"); // survives a broadcast
    click('[data-action="addDone"]');
    await vi.waitFor(() => expect(send).toHaveBeenLastCalledWith({ type: "addAccount:dismiss" }));
    expect(send).toHaveBeenCalledWith({ type: "account:update", accountId: "b", patch: { label: "Home" } });
  });

  it("shows why a sign-in hasn't finished instead of the 15-minute hint", () => {
    const app = mount(root, send, ui({ add: addState({ phase: "waitingLogin" }) }), () => NOW);
    expect(root.textContent).toContain("gives up after 15 minutes");
    const message = "Signed in, but claude.ai's identity check failed — reopen this popup to try again, or Cancel to go back to <Acme>.";
    app.update(ui({ add: addState({ phase: "waitingLogin", message }) }));
    expect(root.querySelector(".pane .err")!.textContent).toBe(message);
    expect(root.textContent).not.toContain("15 minutes");
    expect(root.querySelector('[data-action="addCancel"]')).not.toBeNull();
  });

  it("does not dismiss the add flow when saving the label fails", async () => {
    send.mockRejectedValueOnce(new Error("Label too long"));
    mount(root, send, ui({ add: addState({ phase: "saved", savedAccountId: "b", isNew: true }) }), () => NOW);
    click('[data-action="addDone"]');
    await vi.waitFor(() => expect(root.querySelector(".error")!.textContent).toContain("Label too long"));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("offers both choices on a mismatch", () => {
    mount(root, send, ui({ add: addState({ phase: "mismatch", targetAccountId: "c", mismatchEmail: "x@y.example" }) }), () => NOW);
    expect(root.textContent).toContain("You signed in as x@y.example, not lab@example.com");
    click('[data-action="mismatchAdd"]');
    click('[data-action="mismatchCancel"]');
    expect(send).toHaveBeenNthCalledWith(1, { type: "addAccount:resolveMismatch", addAsNew: true });
    expect(send).toHaveBeenNthCalledWith(2, { type: "addAccount:resolveMismatch", addAsNew: false });
  });

  it("manage: rename, reorder, colour, two-step remove (not the active one), prefs", () => {
    mount(root, send, ui(), () => NOW);
    click('[data-action="manage"]');
    const rename = root.querySelector<HTMLInputElement>('[data-action="rename"][data-id="b"]')!;
    rename.value = "Home";
    rename.dispatchEvent(new Event("change", { bubbles: true }));
    click('[data-action="up"][data-id="b"]');
    click('[data-action="color"][data-id="b"]');
    expect(root.querySelector<HTMLButtonElement>('[data-action="remove"][data-id="a"]')!.disabled).toBe(true);
    click('[data-action="remove"][data-id="b"]');
    expect(root.querySelector('[data-action="remove"][data-id="b"]')!.textContent).toBe("Confirm");
    click('[data-action="remove"][data-id="b"]');
    click('[data-action="pref"][data-pref="style"][data-value="cli"]');
    click('[data-action="toggle"][data-pref="badge"]');
    expect(send.mock.calls.map((c) => c[0])).toEqual([
      { type: "account:update", accountId: "b", patch: { label: "Home" } },
      { type: "account:reorder", order: ["b", "a", "c"] },
      { type: "account:update", accountId: "b", patch: { color: 2 } },
      { type: "account:remove", accountId: "b" },
      { type: "prefs:update", patch: { style: "cli" } },
      { type: "prefs:update", patch: { badge: false } },
    ]);
    expect(root.textContent).toContain("stored unencrypted in this Chrome profile");
    expect([...root.querySelectorAll<HTMLElement>('[data-action="toggle"]')].map((t) => t.dataset.pref)).toEqual(["inPageSwitcher", "badge"]);
  });

  it("manage: the style control shows Claude / CLI while storing app / cli", () => {
    mount(root, send, ui(), () => NOW);
    click('[data-action="manage"]');
    const labels = [...root.querySelectorAll('[data-pref="style"]')].map((b) => [b.textContent, (b as HTMLElement).dataset.value]);
    expect(labels).toEqual([["Claude", "app"], ["CLI", "cli"]]);
  });

  it("escapes labels, emails, the error banner and the mismatch email", () => {
    const evil = `<img src=x onerror=alert(1)>`;
    mount(root, send, ui({ accounts: [acct("x", evil, { email: evil })], error: evil }), () => NOW);
    expect(root.querySelector("img")).toBeNull();
    expect(root.querySelector(".error")!.textContent).toBe(evil);
    expect(root.querySelector(".label")!.textContent).toBe(evil);
    expect(root.querySelector(".email")!.textContent).toBe(evil);
    mount(root, send, ui({ add: addState({ phase: "mismatch", mismatchEmail: evil }) }), () => NOW);
    expect(root.querySelector("img")).toBeNull();
    expect(root.textContent).toContain(evil);
  });

  it("shows an error containing replace patterns verbatim", () => {
    mount(root, send, ui({ error: "bad $& and $' and $` end" }), () => NOW);
    expect(root.querySelector(".error")!.textContent).toBe("bad $& and $' and $` end");
    expect(root.querySelectorAll(".head").length).toBe(1);
    expect(root.querySelector(".list")).not.toBeNull();
  });

  const key = (code: string, init: KeyboardEventInit = {}, target: EventTarget = document) =>
    target.dispatchEvent(new KeyboardEvent("keydown", { code, key: code.slice(-1), bubbles: true, ...init }));

  it("digits 1-9 switch from the list, never for signed-out rows", () => {
    mount(root, send, ui(), () => NOW);
    key("Digit2");
    key("Digit3");
    expect(send.mock.calls).toEqual([[{ type: "switch", accountId: "b" }]]);
  });

  it("digits are ignored with modifiers and inside editable elements (list screen)", () => {
    mount(root, send, ui(), () => NOW);
    key("Digit2", { ctrlKey: true });
    key("Digit2", { metaKey: true });
    key("Digit2", { altKey: true });
    for (const tag of ["input", "textarea", "select"]) {
      const el = document.body.appendChild(document.createElement(tag));
      key("Digit2", {}, el);
    }
    const ce = document.body.appendChild(document.createElement("div"));
    Object.defineProperty(ce, "isContentEditable", { value: true });
    key("Digit2", {}, ce);
    expect(send).not.toHaveBeenCalled();
  });

  it("digits are ignored on the manage screen", () => {
    mount(root, send, ui(), () => NOW);
    click('[data-action="manage"]');
    key("Digit2", {}, root.querySelector('[data-action="rename"]')!);
    expect(send).not.toHaveBeenCalled();
  });

  it("a Manage rename being typed survives update(): value, focus and caret", () => {
    const app = mount(root, send, ui(), () => NOW);
    click('[data-action="manage"]');
    const input = root.querySelector<HTMLInputElement>('[data-action="rename"][data-id="b"]')!;
    input.focus();
    input.value = "Hom";
    input.setSelectionRange(1, 2);
    app.update(ui({ lastSwitch: { accountId: "b", reloadedTabs: 1, at: NOW } }));
    const after = root.querySelector<HTMLInputElement>('[data-action="rename"][data-id="b"]')!;
    expect(document.activeElement).toBe(after);
    expect(after.value).toBe("Hom");
    expect([after.selectionStart, after.selectionEnd]).toEqual([1, 2]);
  });

  it("a focused row stays focused after update()", () => {
    const app = mount(root, send, ui(), () => NOW);
    root.querySelector<HTMLElement>('[data-action="switch"][data-id="b"]')!.focus();
    app.update(ui({ switchingTo: "c" }));
    expect((document.activeElement as HTMLElement).dataset.id).toBe("b");
    expect(document.activeElement!.getAttribute("data-action")).toBe("switch");
  });

  it("an update that renders identically leaves the DOM untouched", () => {
    const app = mount(root, send, ui(), () => NOW);
    const first = root.querySelector(".row");
    app.update(ui());
    expect(root.querySelector(".row")).toBe(first);
  });

  it("Remove needs its own confirmation after any other action", () => {
    mount(root, send, ui(), () => NOW);
    click('[data-action="manage"]');
    click('[data-action="remove"][data-id="b"]');
    click('[data-action="color"][data-id="a"]');
    expect(root.querySelector('[data-action="remove"][data-id="b"]')!.textContent).toBe("Remove");
    click('[data-action="remove"][data-id="b"]');
    expect(send.mock.calls.map((c) => (c[0] as { type: string }).type)).toEqual(["account:update"]);
    click('[data-action="back"]');
    click('[data-action="manage"]');
    expect(root.querySelector('[data-action="remove"][data-id="b"]')!.textContent).toBe("Remove");
  });

  it("shows an empty state that says what + Add account does", () => {
    mount(root, send, ui({ accounts: [], activeId: null, usage: {} }), () => NOW);
    expect(root.textContent).toContain("No accounts yet");
    expect(root.querySelector(".empty")!.textContent).toContain(
      "+ Add account first saves the claude.ai account you're signed into, then opens claude.ai signed out so you can sign in to another.",
    );
  });

  it("the add intro says the current account is saved first, then claude.ai opens signed out", () => {
    mount(root, send, ui(), () => NOW);
    click('[data-action="addIntro"]');
    expect(root.querySelector(".pane")!.textContent).toContain(
      "First we save the claude.ai account you're signed into (if any). Then claude.ai opens signed out, so you can sign in to another account with Google or email.",
    );
  });

  it("applyPrefs sets theme and style on <html>", () => {
    applyPrefs(document, ui({ prefs: { theme: "dark", style: "cli", inPageSwitcher: true, badge: true } }));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(document.documentElement.getAttribute("data-style")).toBe("cli");
    applyPrefs(document, ui());
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });
});
