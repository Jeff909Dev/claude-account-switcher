#!/usr/bin/env node
// Bundles the extension. `--origin` and `--shadow=open` exist only for the e2e build (a local fake claude.ai,
// and an open shadow root Playwright can see into); real builds keep the in-page UI in a closed shadow root.
import { build } from "esbuild";
import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.length ? v.join("=") : "true"];
  }),
);
const origin = new URL(args.origin ?? "https://claude.ai");
const out = args.out ?? "dist";
const pattern = `${origin.protocol}//${origin.hostname}/*`;

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

const common = {
  bundle: true,
  target: "chrome120",
  define: {
    __CLAUDE_ORIGIN__: JSON.stringify(origin.origin),
    __SHADOW_MODE__: JSON.stringify(args.shadow === "open" ? "open" : "closed"),
  },
  logLevel: "warning",
  legalComments: "none",
  sourcemap: args.dev === "true" ? "inline" : false,
};
await Promise.all([
  build({ ...common, entryPoints: ["src/background/index.ts"], outfile: `${out}/background.js`, format: "esm" }),
  build({ ...common, entryPoints: ["src/popup/main.ts"], outfile: `${out}/popup.js`, format: "iife" }),
  build({ ...common, entryPoints: ["src/content/main.ts"], outfile: `${out}/content.js`, format: "iife" }),
]);

const manifest = JSON.parse(await readFile("src/manifest.json", "utf8"));
manifest.host_permissions = [pattern];
for (const cs of manifest.content_scripts) cs.matches = [pattern];
await writeFile(`${out}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);

await cp("src/popup/popup.html", `${out}/popup.html`);
await cp("src/popup/popup.css", `${out}/popup.css`);
await cp("src/shared/tokens.css", `${out}/tokens.css`);
const exists = (p) => access(p).then(() => true, () => false);
if (await exists("src/icons")) await cp("src/icons", `${out}/icons`, { recursive: true });
