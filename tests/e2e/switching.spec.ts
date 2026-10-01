import type { BrowserContext, Page } from "@playwright/test";
import type http from "node:http";
import { FAKE_ORIGIN, startFakeClaude } from "./fakeClaude";
import { expect, test } from "./fixtures";

let server: http.Server;
test.beforeAll(async () => {
  server = await startFakeClaude();
});
test.afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

async function addAccount(context: BrowserContext, popup: Page, who: "work" | "personal") {
  await popup.locator('[data-action="addIntro"]').click();
  const loginOpened = context.waitForEvent("page");
  await popup.locator('[data-action="addStart"]').click();
  const login = await loginOpened;
  await login.waitForLoadState();
  await login.locator(`#as-${who}`).click();
  await expect(popup.getByText(/Saved you@/)).toBeVisible();
  await popup.locator('[data-action="addDone"]').click();
  await expect(popup.locator('[data-action="addIntro"]')).toBeVisible();
}

test("add two accounts, switch between them, rescue a link from the other account", async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`${FAKE_ORIGIN}/new`);
  await expect(page.locator("#who")).toHaveText("Signed out");
  const cfBefore = (await context.cookies(FAKE_ORIGIN)).find((c) => c.name === "cf_clearance")?.value;
  expect(cfBefore).toBeTruthy();

  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);

  await addAccount(context, popup, "work");
  await expect(page.locator("#who")).toHaveText("Signed in as you@work.example");
  await addAccount(context, popup, "personal");
  await expect(page.locator("#who")).toHaveText("Signed in as you@personal.example");

  const second = await context.newPage();
  await second.goto(`${FAKE_ORIGIN}/new`);
  await popup.locator('[data-action="switch"]', { hasText: "you@work.example" }).click();
  await expect(page.locator("#who")).toHaveText("Signed in as you@work.example");
  await expect(second.locator("#who")).toHaveText("Signed in as you@work.example");
  await expect(popup.locator(".row.active")).toContainText("Work");
  await expect(popup.locator(".row.active .usage")).toContainText("5h 25%");
  await expect(popup.locator(".row", { hasText: "Personal" }).locator(".usage")).toContainText("as of");
  for (const usage of await popup.locator(".row .usage").all()) {
    // One line in the 320 px popup, three limits included: every item sits on the first item's line.
    const tops = await usage.locator(".u, .asof").evaluateAll((els) => els.map((el) => Math.round(el.getBoundingClientRect().top)));
    expect(new Set(tops).size).toBe(1);
  }

  expect((await context.cookies(FAKE_ORIGIN)).find((c) => c.name === "cf_clearance")?.value).toBe(cfBefore);

  await page.goto(`${FAKE_ORIGIN}/artifact/personal-only`);
  await expect(page.locator("#artifact")).toHaveText("Not found");
  await page.getByRole("button", { name: /Open as Personal/ }).click();
  await expect(page.locator("#artifact")).toHaveText("Artifact personal-only");
  await expect(popup.locator(".row.active")).toContainText("Personal");

  if (process.env.CAPTURE_SITE_SHOT) {
    await popup.locator('[data-action="switch"]', { hasText: "you@work.example" }).click();
    await expect(popup.locator(".row.active")).toContainText("Work");
    await popup.addStyleTag({ content: ".status { display: none !important; }" }); // hide the transient "Reloaded N tabs" line
    await popup.setViewportSize({ width: 320, height: 240 });
    await popup.mouse.move(0, 0); // no hover highlight left on a row
    await popup.locator("#app").screenshot({ path: "site/screenshot.png" });
  }
});

// Visual review only: `CAPTURE_SHOTS=1 pnpm test:e2e` writes test-results/shots/*.png (git-ignored).
if (process.env.CAPTURE_SHOTS) {
  test("capture the popup, in-page switcher and banner in light and dark", async ({ context, extensionId }) => {
    const shot = (name: string) => ({ path: `test-results/shots/${name}.png` });
    const schemes = ["light", "dark"] as const;
    const page = await context.newPage();
    await page.setViewportSize({ width: 720, height: 420 });
    await page.goto(`${FAKE_ORIGIN}/new`);
    const popup = await context.newPage();
    await popup.goto(`chrome-extension://${extensionId}/popup.html`);
    await addAccount(context, popup, "work");
    await addAccount(context, popup, "personal");
    await popup.locator('[data-action="switch"]', { hasText: "you@work.example" }).click();
    await expect(popup.locator(".row.active .usage")).toContainText("5h 25%");
    await expect(popup.locator(".row", { hasText: "Personal" }).locator(".usage")).toContainText("as of");

    for (const colorScheme of schemes) {
      await popup.emulateMedia({ colorScheme });
      await popup.locator("#app").screenshot(shot(`popup-${colorScheme}`));
    }
    await popup.emulateMedia({ colorScheme: "light" });
    await popup.locator('[data-action="addIntro"]').click();
    await popup.locator("#app").screenshot(shot("popup-add-light"));

    await expect(page.locator("#who")).toHaveText("Signed in as you@work.example");
    for (const colorScheme of schemes) {
      await page.emulateMedia({ colorScheme });
      await page.locator(".pill").click();
      await expect(page.locator(".menu")).toBeVisible();
      await page.screenshot(shot(`inpage-${colorScheme}`));
      await page.keyboard.press("Escape");
      await expect(page.locator(".menu")).toBeHidden();
    }

    await page.goto(`${FAKE_ORIGIN}/artifact/personal-only`);
    await expect(page.getByRole("button", { name: /Open as Personal/ })).toBeVisible();
    for (const colorScheme of schemes) {
      await page.emulateMedia({ colorScheme });
      await page.screenshot(shot(`banner-${colorScheme}`));
    }
  });
}
