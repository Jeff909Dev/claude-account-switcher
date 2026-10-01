import { expect, test } from "@playwright/test";
import path from "node:path";

const SITE = `file://${path.resolve("site/index.html")}`;
const DOWNLOAD = "https://github.com/Jeff909Dev/claude-account-switcher/releases/latest/download/claude-account-switcher.zip";

for (const width of [390, 1280]) {
  test(`landing page renders at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(SITE);
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.locator("#download")).toHaveAttribute("href", DOWNLOAD);
    await expect(page.getByRole("link", { name: /GitHub/ }).first()).toHaveAttribute("href", "https://github.com/Jeff909Dev/claude-account-switcher");
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
    expect(await page.locator(".shot img").evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
    await page.screenshot({ path: `test-results/site/site-${width}.png`, fullPage: true });
  });
}
