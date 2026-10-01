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

  it("has no console.log / info / debug", () => {
    for (const f of SRC) expect(readFileSync(f, "utf8"), f).not.toMatch(/console\.(log|info|debug)\(/);
  });
});
