import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function buildInto(...args: string[]): string {
  const out = mkdtempSync(join(tmpdir(), "cas-build-"));
  execFileSync(process.execPath, ["scripts/build.mjs", `--out=${out}`, ...args], { stdio: "pipe" });
  return out;
}

describe("build", () => {
  it("production build targets only https://claude.ai with the exact permissions", () => {
    const out = buildInto();
    const m = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
    expect(m.manifest_version).toBe(3);
    expect(m.host_permissions).toEqual(["https://claude.ai/*"]);
    expect(m.content_scripts[0].matches).toEqual(["https://claude.ai/*"]);
    expect([...m.permissions].sort()).toEqual(
      ["alarms", "cookies", "storage", "webRequest"].sort(),
    );
    expect(m.commands._execute_action.suggested_key.default).toBe("Alt+Shift+A");
    // Chrome Web Store: a third-party name must not read as official.
    expect(m.name).toBe("Account Switcher for Claude");
    expect(m.short_name).toBe("Account Switcher");
    expect(m.action.default_title).toBe(m.name);
    expect(m.description.length).toBeLessThanOrEqual(132);
    expect(m.description).toContain("Unofficial — not affiliated with Anthropic.");
    expect(m.version).toBe(JSON.parse(readFileSync("package.json", "utf8")).version);
    expect(readFileSync(join(out, "background.js"), "utf8")).toContain("https://claude.ai");
    expect(readFileSync(join(out, "content.js"), "utf8")).not.toContain(`"open"`); // the in-page UI's shadow root stays closed
    for (const f of ["popup.html", "popup.css", "popup.js", "content.js", "tokens.css"]) {
      expect(readFileSync(join(out, f), "utf8").length).toBeGreaterThan(0);
    }
  });

  it("e2e build points at the local fake origin", () => {
    const out = buildInto("--origin=http://localhost:4319", "--shadow=open");
    const m = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
    expect(m.host_permissions).toEqual(["http://localhost/*"]);
    expect(m.content_scripts[0].matches).toEqual(["http://localhost/*"]);
    expect(readFileSync(join(out, "background.js"), "utf8")).toContain("http://localhost:4319");
    expect(readFileSync(join(out, "content.js"), "utf8")).toContain(`"open"`); // Playwright only sees into open shadow roots
  });
});

describe("packaging", () => {
  it("ships PNG icons referenced by the manifest", () => {
    const out = buildInto();
    const m = JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"));
    for (const size of ["16", "32", "48", "128"]) {
      expect(m.icons[size]).toBe(`icons/icon-${size}.png`);
      expect(m.action.default_icon[size]).toBe(`icons/icon-${size}.png`);
      const png = readFileSync(join(out, m.icons[size]));
      expect(png.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
      expect(png.readUInt32BE(16)).toBe(Number(size));
    }
  });

  it("pnpm zip produces claude-account-switcher.zip with the manifest at its root", () => {
    execFileSync("pnpm", ["zip"], { stdio: "pipe" });
    const listing = execFileSync("unzip", ["-l", "claude-account-switcher.zip"], { encoding: "utf8" });
    expect(listing).toMatch(/\smanifest\.json\n/);
    expect(listing).toContain("icons/icon-128.png");
    expect(listing).not.toContain("dist/");
  });
});
