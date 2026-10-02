import type { BrowserContext, Page } from "@playwright/test";
import { expect } from "./fixtures";

/** Popup → + Add account → sign in on the fake claude.ai as `who` → Done. */
export async function addAccount(context: BrowserContext, popup: Page, who: "work" | "personal") {
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
