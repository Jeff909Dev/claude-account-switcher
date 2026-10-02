import { expect, test } from "@playwright/test";
import path from "node:path";

const SITE = `file://${path.resolve("site/index.html")}`;
const PRIVACY = `file://${path.resolve("site/privacy.html")}`;
const REPO = "https://github.com/Jeff909Dev/claude-account-switcher";
const DOWNLOAD = `${REPO}/releases/latest/download/claude-account-switcher.zip`;

for (const width of [390, 1280]) {
  test(`landing page renders at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(SITE);
    await expect(page).toHaveTitle("Account Switcher for Claude");
    await expect(page.locator(".name")).toHaveText("Account Switcher for Claude");
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.locator("#download")).toHaveAttribute("href", DOWNLOAD);
    await expect(page.getByRole("link", { name: /GitHub/ }).first()).toHaveAttribute("href", REPO);
    await expect(page.locator("footer").getByRole("link", { name: "Privacy policy" })).toHaveAttribute("href", "privacy.html");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    expect(await page.locator(".shot img").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    await page.screenshot({ path: `test-results/site/site-${width}.png`, fullPage: true });
  });

  test(`privacy policy renders at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(PRIVACY);
    await expect(page).toHaveTitle("Privacy policy · Account Switcher for Claude");
    await expect(page.locator("h1")).toHaveText("Privacy policy");
    for (const heading of ["What it stores", "What it sends, and to whom", "Keeping and deleting your data", "Contact"]) {
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    }
    await expect(page.getByRole("link", { name: "GitHub issues" })).toHaveAttribute("href", `${REPO}/issues`);
    await expect(page.getByRole("link", { name: "Account Switcher for Claude" })).toHaveAttribute("href", "./");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    await page.screenshot({ path: `test-results/site/privacy-${width}.png`, fullPage: true });
  });
}
