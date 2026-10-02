import type { Page } from "@playwright/test";
import fs from "node:fs";
import type http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { FAKE_ORIGIN, startFakeClaude } from "./fakeClaude";
import { expect, test } from "./fixtures";
import { addAccount } from "./flows";

// Chrome Web Store assets: `CAPTURE_STORE=1 pnpm test:e2e` renders store/screenshots/*.png (1280×800) from the real
// extension against the fake claude.ai, and store/promo-440x280.png from store/promo-440x280.html.
if (process.env.CAPTURE_STORE) {
  const RAW = path.resolve("test-results/store");
  const SHOTS = path.resolve("store/screenshots");
  const ICON = pathToFileURL(path.resolve("store/icon-128.png")).href;
  const TOKENS = fs.readFileSync("site/tokens.css", "utf8");

  /** Width and height of a PNG, from its IHDR chunk. */
  const pngSize = (file: string) => {
    const b = fs.readFileSync(file);
    return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  };

  /** A neutral chat app around the fake claude.ai page, so the extension's UI is seen where it lives. */
  const DEMO_CSS = `
    body { margin: 0; font-family: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif !important; background: #faf9f5; color: #141413; }
    body > p { display: none; }
    .demo { display: grid; grid-template-columns: 240px 1fr; height: 100vh; font-size: 14px; }
    .side { display: flex; flex-direction: column; gap: 2px; padding: 14px 10px; background: #f5f4ed; border-right: 0.5px solid rgba(31,30,29,.12); }
    .side .new { margin-bottom: 14px; padding: 8px 10px; border-radius: 8px; font-weight: 500; }
    .side .label { padding: 4px 10px; color: #73726c; font-size: 12px; }
    .side .item { padding: 6px 10px; border-radius: 8px; color: #3d3d3a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .side .item.on { background: #e8e6dc; color: #141413; }
    .side .user { margin-top: auto; display: flex; align-items: center; gap: 8px; width: 120px; padding: 6px 8px; border: 0; border-radius: 8px; background: transparent; font: inherit; color: #3d3d3a; text-align: left; }
    .side .av { display: inline-grid; place-items: center; width: 26px; height: 26px; border-radius: 50%; background: #3d3d3a; color: #fff; font-size: 12px; font-weight: 600; }
    main { display: flex; flex-direction: column; min-width: 0; }
    .thread { flex: 1; width: min(620px, 100% - 64px); margin: 0 auto; padding: 36px 0 0; line-height: 1.6; }
    .msg.user { margin-left: auto; width: fit-content; max-width: 80%; padding: 10px 14px; border-radius: 14px; background: #f0eee6; }
    .msg.bot { margin-top: 22px; font-family: Georgia, ui-serif, serif; font-size: 15px; }
    .msg.bot p { margin: 0 0 8px; } .msg.bot ul { margin: 0; padding-left: 20px; } .msg.bot li { margin: 4px 0; }
    .composer { width: min(620px, 100% - 64px); margin: 0 auto 24px; padding: 14px 16px; border-radius: 16px; border: 0.5px solid rgba(31,30,29,.22); background: #fff; color: #a3a19a; box-shadow: 0 2px 10px rgba(20,20,19,.05); }
    .nf { flex: 1; display: grid; place-content: center; text-align: center; gap: 6px; }
    .nf b { font-family: Georgia, ui-serif, serif; font-weight: 400; font-size: 24px; }
    .nf span { color: #73726c; }
  `;
  const sidebar = (current: string) =>
    `<aside class="side"><div class="new">+ New chat</div><div class="label">Recents</div>${[
      "Meeting notes summary", "Regex for ISO dates", "Weekend trip ideas", "Fix a flaky CI test", "Draft release notes",
    ].map((t) => `<div class="item${t === current ? " on" : ""}">${t}</div>`).join("")}<button class="user" data-testid="user-menu-button"><span class="av">Y</span><span>You</span></button></aside>`;
  const THREAD = `<div class="thread"><div class="msg user">Can you turn these meeting notes into three bullet points?</div><div class="msg bot"><p>Here are the key points:</p><ul><li>The launch moves to the 14th so QA can finish the payment flow.</li><li>Maya owns the release notes; Sam updates the onboarding docs.</li><li>Next check-in is Thursday at 10:00.</li></ul></div></div><div class="composer">Reply…</div>`;
  const NOT_FOUND = `<div class="nf"><b>Artifact not found</b><span>It doesn't exist, or you don't have access to it.</span></div>`;

  async function dress(page: Page, current: string, main: string) {
    await page.evaluate(
      ([css, html]) => {
        const style = document.createElement("style");
        style.textContent = css!;
        document.head.append(style);
        document.body.insertAdjacentHTML("afterbegin", html!);
      },
      [DEMO_CSS, `<div class="demo">${sidebar(current)}<main>${main}</main></div>`],
    );
  }

  /** One 1280×800 store screenshot: a caption plus a real capture, in the landing page's look. */
  async function frame(page: Page, name: string, o: { title: string; sub: string; shot: string; layout: "top" | "side"; width: number }) {
    const html = `<!doctype html><html data-theme="light"><head><meta charset="utf-8"><style>${TOKENS}
      html, body { width: 1280px; height: 800px; overflow: hidden; }
      body { background: radial-gradient(90% 120% at 100% 100%, #f0eee6 0%, #faf9f5 60%); font-family: var(--font-sans); }
      .eyebrow { display: flex; align-items: center; gap: 10px; font-size: 15px; font-weight: 600; }
      .eyebrow img { width: 26px; height: 26px; }
      .eyebrow small { margin-left: auto; color: var(--muted); font-size: 12px; font-weight: 400; }
      h1 { font-family: var(--font-serif); font-weight: 400; font-size: 38px; line-height: 1.15; margin: 14px 0 8px; letter-spacing: -0.01em; }
      p { margin: 0; color: var(--text-2); font-size: 18px; line-height: 1.5; }
      .shot { display: block; border-radius: 14px; box-shadow: 0 24px 60px rgba(20, 20, 19, 0.16), 0 0 0 0.5px rgba(31, 30, 29, 0.22); }
      .top { padding: 34px 100px 0; }
      .top .shot { margin-top: 22px; }
      .side { display: grid; grid-template-columns: 1fr auto; align-items: center; gap: 72px; height: 800px; padding: 0 110px; }
      .side .eyebrow { margin-bottom: 18px; } .side h1 { font-size: 44px; } .side p { font-size: 19px; }
    </style></head><body class="${o.layout}">
      <div><div class="eyebrow"><img src="${ICON}" alt=""><span>Account Switcher for Claude</span>${o.layout === "top" ? "<small>Unofficial — not affiliated with Anthropic.</small>" : ""}</div>
      <h1>${o.title}</h1><p>${o.sub}</p>${o.layout === "side" ? `<p style="margin-top:28px;font-size:13px;color:var(--muted)">Unofficial — not affiliated with Anthropic.</p>` : ""}</div>
      <img class="shot" src="${pathToFileURL(o.shot).href}" style="width:${o.width}px" alt="">
    </body></html>`;
    const file = path.join(RAW, `${name}.html`);
    fs.writeFileSync(file, html);
    await page.goto(pathToFileURL(file).href);
    await page.evaluate(() => Promise.all([...document.images].map((i) => i.decode())));
    const out = path.join(SHOTS, `${name}.png`);
    await page.screenshot({ path: out, scale: "css" });
    expect(pngSize(out)).toEqual({ width: 1280, height: 800 });
  }

  let server: http.Server;
  test.beforeAll(async () => {
    server = await startFakeClaude();
    fs.mkdirSync(RAW, { recursive: true });
    fs.mkdirSync(SHOTS, { recursive: true });
  });
  test.afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  test.use({ deviceScaleFactor: 2 });

  test("render the Chrome Web Store screenshots and promo tile", async ({ context, extensionId }) => {
    const raw = (name: string) => path.join(RAW, `raw-${name}.png`);
    const page = await context.newPage();
    await page.setViewportSize({ width: 1000, height: 560 });
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto(`${FAKE_ORIGIN}/new`);
    const popup = await context.newPage();
    await popup.emulateMedia({ colorScheme: "light" });
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await addAccount(context, popup, "work");
    await addAccount(context, popup, "personal");
    await popup.locator('[data-action="switch"]', { hasText: "you@work.example" }).click();
    await expect(popup.locator(".row.active")).toContainText("Work");
    await expect(popup.locator(".row.active .usage")).toContainText("5h 25%");
    await expect(popup.locator(".row", { hasText: "Personal" }).locator(".usage")).toContainText("as of");
    await popup.addStyleTag({ content: ".status { display: none !important; }" }); // the transient "Reloaded N tabs" line
    await popup.mouse.move(0, 0);
    await popup.locator("#app").screenshot({ path: raw("popup") });
    await popup.locator('[data-action="manage"]').click();
    await popup.mouse.move(0, 0);
    await popup.locator("#app").screenshot({ path: raw("manage") });

    await expect(page.locator("#who")).toHaveText("Signed in as you@work.example");
    await dress(page, "Meeting notes summary", THREAD);
    await expect(page.locator('.cas-switch[data-placement="anchored"]')).toBeVisible();
    await page.locator(".pill").click();
    await expect(page.locator(".menu")).toBeVisible();
    await page.mouse.move(0, 0);
    await page.screenshot({ path: raw("inpage") });

    await page.goto(`${FAKE_ORIGIN}/artifact/personal-only`);
    await expect(page.getByRole("button", { name: /Open as Personal/ })).toBeVisible();
    await dress(page, "", NOT_FOUND);
    await expect(page.locator('.cas-switch[data-placement="anchored"]')).toBeVisible();
    await page.mouse.move(0, 0);
    await page.screenshot({ path: raw("banner") });

    const out = await context.newPage();
    await out.setViewportSize({ width: 1280, height: 800 });
    await frame(out, "1-switch-accounts", {
      layout: "side", shot: raw("popup"), width: 520,
      title: "Every claude.ai account, one click away.",
      sub: "Save each account once. Click one — or press 1–9 — and your claude.ai tabs reload signed in as it. Each row shows its usage at a glance.",
    });
    await frame(out, "2-in-page-switcher", {
      layout: "top", shot: raw("inpage"), width: 1080,
      title: "Switch right from claude.ai.",
      sub: "A small switcher sits next to your account menu. Alt+1–9 (⌥1–9 on Mac) switches without leaving the keyboard.",
    });
    await frame(out, "3-open-as", {
      layout: "top", shot: raw("banner"), width: 1080,
      title: "Links open in the account they belong to.",
      sub: "An artifact, chat or project from another account? The banner offers “Open as …”: one click and you're there.",
    });
    await frame(out, "4-manage-and-privacy", {
      layout: "side", shot: raw("manage"), width: 520,
      title: "Yours to arrange. Kept in your browser.",
      sub: "Rename, reorder, colour or remove accounts. Sessions stay in this Chrome profile, and the extension only talks to claude.ai: no servers, no analytics.",
    });

    await out.setViewportSize({ width: 440, height: 280 });
    await out.goto(pathToFileURL(path.resolve("store/promo-440x280.html")).href);
    await out.evaluate(() => Promise.all([...document.images].map((i) => i.decode())));
    await out.screenshot({ path: "store/promo-440x280.png", scale: "css" });
    expect(pngSize("store/promo-440x280.png")).toEqual({ width: 440, height: 280 });
  });
}
