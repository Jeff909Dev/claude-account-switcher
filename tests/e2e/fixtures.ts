import { chromium, test as base, type BrowserContext } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const test = base.extend<{ context: BrowserContext; extensionId: string }>({
  context: async ({ deviceScaleFactor }, use) => {
    const ext = path.resolve("dist-e2e");
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "cas-e2e-"));
    const context = await chromium.launchPersistentContext(userDataDir, {
      channel: "chromium",
      headless: !process.env.HEADED,
      args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
      ...(deviceScaleFactor ? { deviceScaleFactor } : {}), // test.use({ deviceScaleFactor: 2 }) for crisp store screenshots
    });
    await use(context);
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  },
  extensionId: async ({ context }, use) => {
    let [worker] = context.serviceWorkers();
    if (!worker) worker = await context.waitForEvent("serviceworker");
    await use(new URL(worker.url()).host);
  },
});

export const expect = test.expect;
