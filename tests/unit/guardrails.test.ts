import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? tsFiles(p) : p.endsWith(".ts") ? [p] : [];
  });
}
const SRC = tsFiles("src");

describe("guardrails", () => {
  it("never references a claude.ai log-out endpoint", () => {
    for (const f of SRC) expect(readFileSync(f, "utf8"), f).not.toMatch(/logout/i);
  });

  it("only ever talks to claude.ai", () => {
    for (const f of SRC) {
      const urls = readFileSync(f, "utf8").match(/https?:\/\/[^\s"'`)<]+/g) ?? [];
      for (const u of urls) expect(u.startsWith("https://claude.ai"), `${f}: ${u}`).toBe(true);
    }
  });

  it("asks for exactly the permissions the chrome.* APIs it uses need", () => {
    // null: works without a permission. tabs.query({ url }) on claude.ai tabs, tabs.get(...).url and
    // tabs.onUpdated's url only need the claude.ai host permission (tests/fakes/chrome.ts behaves the same).
    const NEEDS: Record<string, string | null> = {
      cookies: "cookies", storage: "storage", alarms: "alarms", webRequest: "webRequest", tabs: null, runtime: null, action: null,
    };
    const used = new Set(SRC.flatMap((f) => [...readFileSync(f, "utf8").matchAll(/\bchrome\.([a-zA-Z]+)/g)].map((m) => m[1]!)));
    for (const api of used) expect(Object.keys(NEEDS), `chrome.${api}: which permission does it need?`).toContain(api);
    const needed = [...used].map((api) => NEEDS[api]).filter((p): p is string => typeof p === "string");
    const manifest = JSON.parse(readFileSync("src/manifest.json", "utf8")) as { permissions: string[] };
    expect([...manifest.permissions].sort()).toEqual([...new Set(needed)].sort());
  });

  it("has no console.log / info / debug", () => {
    for (const f of SRC) expect(readFileSync(f, "utf8"), f).not.toMatch(/console\.(log|info|debug)\(/);
  });
});
