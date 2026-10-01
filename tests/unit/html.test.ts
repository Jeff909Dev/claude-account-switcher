import { describe, expect, it } from "vitest";
import { accountRowParts, esc } from "../../src/shared/html";
import { acct, ui } from "./uiFixtures";

describe("accountRowParts", () => {
  const s = ui();
  it("active: check mark; others: Alt+N hint up to 9; none beyond", () => {
    expect(accountRowParts(s.accounts[0]!, 0, s).right).toContain("check");
    expect(accountRowParts(s.accounts[1]!, 1, s).right).toContain("⌥2");
    expect(accountRowParts(s.accounts[1]!, 9, s).right).not.toContain("⌥");
  });
  it("switching: spinner", () => {
    expect(accountRowParts(s.accounts[1]!, 1, { ...s, switchingTo: "b" }).right).toContain("spinner");
  });
  it("sub: email, or a sign-in notice; both escaped", () => {
    expect(accountRowParts(s.accounts[2]!, 2, s).sub).toContain("signed out — sign in again");
    expect(accountRowParts(acct("x", "X", { email: "<b>@e.x" }), 0, s).sub).toContain("&lt;b&gt;@e.x");
  });
  it("esc escapes the five characters", () => {
    expect(esc(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
  });
});
