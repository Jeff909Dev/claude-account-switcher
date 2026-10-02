// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBanner } from "../../src/content/banner";
import { ensureHost, HOST_ID } from "../../src/content/host";
import { digitShortcut, installKeys, isEditable } from "../../src/content/keys";
import { placement } from "../../src/content/anchors";
import { boot } from "../../src/content/boot";
import { CONTENT_CSS } from "../../src/content/styles";
import { createSwitcher } from "../../src/content/switcherUi";
import type { RescueInfo } from "../../src/shared/types";
import { acct, ui } from "./uiFixtures";

const state = ui;
const key = (code: string, mods: Partial<Record<"altKey" | "shiftKey" | "metaKey" | "ctrlKey", boolean>> = {}) => ({
  code, altKey: false, shiftKey: false, metaKey: false, ctrlKey: false, ...mods,
});

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("keys", () => {
  it("never steals ⌥digits while typing (⌥2 is '@' on a Spanish Mac keyboard)", () => {
    document.body.innerHTML = `<textarea id="t"></textarea><div id="pm" contenteditable="true"><p id="inner">x</p></div><input id="cb" type="checkbox">`;
    expect(digitShortcut(key("Digit2", { altKey: true }), document.getElementById("t"))).toBeNull();
    expect(digitShortcut(key("Digit2", { altKey: true }), document.getElementById("inner"))).toBeNull();
    expect(digitShortcut(key("Digit2", { altKey: true }), document.getElementById("cb"))).toBe(2);
    expect(digitShortcut(key("Digit2", { altKey: true }), document.body)).toBe(2);
  });

  it("only plain ⌥1–9", () => {
    expect(digitShortcut(key("Digit2"), document.body)).toBeNull();
    expect(digitShortcut(key("Digit2", { altKey: true, shiftKey: true }), document.body)).toBeNull();
    expect(digitShortcut(key("Digit2", { altKey: true, metaKey: true }), document.body)).toBeNull();
    expect(digitShortcut(key("Digit0", { altKey: true }), document.body)).toBeNull();
    expect(isEditable(null)).toBe(false);
  });

  it("installKeys switches to the nth account, skipping signed-out ones", () => {
    const onSwitch = vi.fn();
    const off = installKeys(window, () => state().accounts, onSwitch);
    const ev = new KeyboardEvent("keydown", { code: "Digit2", altKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(ev);
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Digit3", altKey: true, bubbles: true }));
    expect(onSwitch.mock.calls).toEqual([["b"]]);
    expect(ev.defaultPrevented).toBe(true);
    off();
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Digit2", altKey: true, bubbles: true }));
    expect(onSwitch).toHaveBeenCalledTimes(1);
  });
});

describe("host + placement", () => {
  it("creates one closed shadow root (claude.ai's scripts can't read the accounts) that inherits the page font", () => {
    const a = ensureHost(document);
    const b = ensureHost(document);
    expect(a).toBe(b);
    expect(a.mode).toBe("closed");
    expect(document.getElementById(HOST_ID)!.shadowRoot).toBeNull();
    expect(document.querySelectorAll(`#${HOST_ID}`)).toHaveLength(1);
    expect(CONTENT_CSS).toContain("font-family: inherit");
  });

  it("anchors next to the sidebar account button, else floats bottom-left", () => {
    expect(placement(null, { width: 1200, height: 800 })).toEqual({ mode: "floating", left: 12, top: 760 });
    const el = document.createElement("button");
    el.getBoundingClientRect = () => ({ left: 10, top: 740, right: 200, bottom: 772, width: 190, height: 32, x: 10, y: 740, toJSON: () => ({}) }) as DOMRect;
    expect(placement(el, { width: 1200, height: 800 })).toEqual({ mode: "anchored", left: 206, top: 742 });
  });
});

describe("in-page switcher", () => {
  it("opens a menu, switches, signs in again, adds, and hides when disabled", () => {
    const send = vi.fn();
    const view = createSwitcher(ensureHost(document), document, send);
    view.update(state());
    const root = view.element;
    expect(root.querySelector(".pill")!.textContent).toContain("Acme");
    root.querySelector<HTMLElement>('[data-action="toggle"]')!.click();
    expect(root.querySelector<HTMLElement>(".menu")!.hidden).toBe(false);
    expect(root.querySelector(".hint")!.textContent).toContain("⌥1–9");
    root.querySelector<HTMLElement>('[data-action="switch"][data-id="b"]')!.click();
    root.querySelector<HTMLElement>('[data-action="toggle"]')!.click();
    root.querySelector<HTMLElement>('[data-action="signin"][data-id="c"]')!.click();
    root.querySelector<HTMLElement>('[data-action="toggle"]')!.click();
    root.querySelector<HTMLElement>('[data-action="add"]')!.click();
    expect(send.mock.calls.map((c) => c[0])).toEqual([
      { type: "switch", accountId: "b" },
      { type: "addAccount:start", targetAccountId: "c" },
      { type: "addAccount:start" },
    ]);
    view.update(state({ prefs: { theme: "system", style: "app", inPageSwitcher: false, badge: true } }));
    expect(root.hidden).toBe(true);
    view.destroy();
  });
});

describe("rescue banner", () => {
  const info = (over: Partial<RescueInfo> = {}): RescueInfo => ({
    resourceKey: "artifact:7f3c",
    kind: "artifact",
    currentAccountId: "a",
    candidates: [acct("b", "Personal"), acct("c", "Lab", { status: "signedOut" })],
    rememberedAccountId: null,
    ...over,
  });

  it("names the current account and offers Open as… for the others", async () => {
    const send = vi.fn(async () => null);
    const banner = createBanner(ensureHost(document), document, send);
    banner.setState(state());
    banner.show(info());
    const el = banner.element;
    expect(el.hidden).toBe(false);
    expect(el.textContent).toContain("This isn't in Acme (acme@example.com)");
    expect(el.querySelector<HTMLButtonElement>('[data-action="openAs"][data-id="c"]')!.disabled).toBe(true);
    expect(el.querySelector('[data-action="probe"]')).toBeNull();
    el.querySelector<HTMLElement>('[data-action="openAs"][data-id="b"]')!.click();
    expect(send).toHaveBeenCalledWith({ type: "rescue:openAs", accountId: "b", resourceKey: "artifact:7f3c" });
    expect(el.textContent).toContain("Switching");
  });

  it("highlights the remembered account and offers adding one when there are no others", () => {
    const send = vi.fn(async () => null);
    const banner = createBanner(ensureHost(document), document, send);
    banner.setState(state());
    banner.show(info({ rememberedAccountId: "b" }));
    expect(banner.element.textContent).toContain("Last opened as Personal");
    expect(banner.element.querySelector('[data-action="openAs"][data-id="b"]')!.classList.contains("primary")).toBe(true);
    banner.show(info({ resourceKey: "chat:x", candidates: [] }));
    banner.element.querySelector<HTMLElement>('[data-action="add"]')!.click();
    expect(send).toHaveBeenCalledWith({ type: "addAccount:start" });
  });

  it("escapes labels and can be dismissed", () => {
    const banner = createBanner(ensureHost(document), document, vi.fn(async () => null));
    banner.setState(state({ accounts: [acct("a", "<b>x</b>")] }));
    banner.show(info({ candidates: [] }));
    expect(banner.element.querySelector("b")).toBeNull();
    expect(banner.element.textContent).toContain("<b>x</b>");
    banner.element.querySelector<HTMLElement>('[data-action="close"]')!.click();
    expect(banner.element.hidden).toBe(true);
  });
});

describe("failures never hang", () => {
  const info: RescueInfo = { resourceKey: "chat:x", kind: "chat", currentAccountId: "a", candidates: [acct("b", "Personal")], rememberedAccountId: null };

  it("banner shows the error when Open as fails and offers the buttons again", async () => {
    const banner = createBanner(ensureHost(document), document, vi.fn(async () => { throw new Error("boom"); }));
    banner.setState(state());
    banner.show(info);
    banner.element.querySelector<HTMLElement>('[data-action="openAs"][data-id="b"]')!.click();
    await vi.waitFor(() => expect(banner.element.textContent).toContain("boom"));
    expect(banner.element.querySelector('[data-action="openAs"][data-id="b"]')).not.toBeNull();
  });

  it("a state push during switching keeps the banner on Switching", async () => {
    let fail: (e: Error) => void = () => undefined;
    const banner = createBanner(ensureHost(document), document, () => new Promise((_, rej) => { fail = rej; }));
    banner.setState(state());
    banner.show(info);
    banner.element.querySelector<HTMLElement>('[data-action="openAs"]')!.click();
    banner.setState(state());
    expect(banner.element.textContent).toContain("Switching");
    fail(new Error("nope"));
    await vi.waitFor(() => expect(banner.element.textContent).toContain("nope"));
  });

  it("switcher shows a failed action in the menu", async () => {
    const view = createSwitcher(ensureHost(document), document, vi.fn(async () => { throw new Error("no luck"); }));
    view.update(state());
    view.element.querySelector<HTMLElement>('[data-action="toggle"]')!.click();
    view.element.querySelector<HTMLElement>('[data-action="add"]')!.click();
    await vi.waitFor(() => expect(view.element.textContent).toContain("no luck"));
    view.destroy();
  });

  it("switcher rows reuse the shared row parts (spinner while switching)", () => {
    const view = createSwitcher(ensureHost(document), document, vi.fn());
    view.update(state({ switchingTo: "b" }));
    expect(view.element.querySelector('[data-id="b"] .spinner')).not.toBeNull();
    expect(view.element.querySelector('[data-id="c"] .err')!.textContent).toContain("signed out");
    view.destroy();
  });
});


describe("keys: held and composing", () => {
  it("ignores repeats and IME composition", () => {
    expect(digitShortcut({ ...key("Digit2", { altKey: true }), repeat: true } as KeyboardEvent, document.body)).toBeNull();
    const onSwitch = vi.fn();
    const off = installKeys(window, () => state().accounts, onSwitch);
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Digit2", altKey: true, repeat: true, bubbles: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Digit2", altKey: true, isComposing: true, bubbles: true }));
    expect(onSwitch).not.toHaveBeenCalled();
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Digit2", altKey: true, bubbles: true }));
    expect(onSwitch).toHaveBeenCalledTimes(1);
    off();
  });
});

describe("boot", () => {
  const handles: { destroy(): void }[] = [];
  afterEach(() => handles.splice(0).forEach((h) => h.destroy()));
  const setup = (send: (req: { type: string }) => Promise<unknown>) => {
    let listener: ((msg: unknown) => void) | undefined;
    const done = boot({ doc: document, win: window, send: send as never, onMessage: (cb) => { listener = cb; }, retryDelaysMs: [0, 0, 0], settleMs: 5 });
    void done.then((h) => handles.push(h));
    return { done, push: (m: unknown) => listener!(m) };
  };
  const host = () => document.getElementById(HOST_ID)!;
  /** The mounted host's (closed) shadow root: ensureHost hands back the one it made. */
  const shadow = () => {
    expect(document.getElementById(HOST_ID)).not.toBeNull();
    return ensureHost(document);
  };

  it("retries getState and mounts once it answers", async () => {
    let calls = 0;
    const { done } = setup(async (req) => {
      if (req.type === "getState" && ++calls <= 2) throw new Error("asleep");
      return req.type === "getState" ? state() : null;
    });
    await done;
    expect(calls).toBe(3);
    expect(shadow().querySelector(".pill")!.textContent).toContain("Acme");
  });

  it("shows an unavailable pill when getState never answers, and recovers on a state push", async () => {
    const { done, push } = setup(async () => { throw new Error("asleep"); });
    await done;
    const root = shadow();
    expect(root.querySelector<HTMLElement>(".cas-switch")!.hidden).toBe(false);
    expect(root.textContent).toContain("Account switcher unavailable — reload");
    push({ type: "state", state: state() });
    expect(root.textContent).not.toContain("unavailable");
    expect(root.querySelector(".pill")!.textContent).toContain("Acme");
  });

  it("applies pushes that arrive before getState resolves", async () => {
    let release: (s: unknown) => void = () => undefined;
    const { done, push } = setup((req) => (req.type === "getState" ? new Promise((r) => { release = r; }) : Promise.resolve(null)));
    push({ type: "state", state: state({ activeId: "b" }) });
    push({ type: "rescue:show", rescue: { resourceKey: "chat:x", kind: "chat", currentAccountId: "b", candidates: [acct("a", "Acme")], rememberedAccountId: null } });
    release(state());
    await done;
    const root = shadow();
    expect(root.querySelector(".pill")!.textContent).toContain("Personal");
    expect(root.querySelector(".banner")!.textContent).toContain("This isn't in Personal");
  });

  it("remounts after the page removes the host, without double-mounting", async () => {
    const { done } = setup(async (req) => (req.type === "getState" ? state() : null));
    await done;
    host().remove();
    document.body.appendChild(document.createElement("div")); // mutation → debounced check
    await vi.waitFor(() => expect(document.getElementById(HOST_ID)).not.toBeNull());
    expect(document.querySelectorAll(`#${HOST_ID}`)).toHaveLength(1);
    expect(shadow().querySelectorAll(".cas-switch")).toHaveLength(1);
    const second = setup(async (req) => (req.type === "getState" ? state() : null));
    await second.done;
    expect(document.querySelectorAll(`#${HOST_ID}`)).toHaveLength(1);
    expect(shadow().querySelectorAll(".cas-switch")).toHaveLength(1);
  });
});
