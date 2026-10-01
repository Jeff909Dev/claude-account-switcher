import { describe, expect, it, vi } from "vitest";
import {
  AuthError,
  NetworkError,
  fetchUsageJson,
  hostMatchesClaude,
  isResourceMiss,
  loginUrl,
  parseIdentity,
  planLabel,
  retargetOrg,
  whoAmI,
} from "../../src/background/claudeApi";
import bootstrap from "../fixtures/bootstrap.json";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("parseIdentity", () => {
  it("picks the chat organization and maps the plan", () => {
    expect(parseIdentity(bootstrap)).toEqual({
      accountUuid: "11111111-1111-4111-8111-111111111111",
      email: "jeff@example.com",
      name: "Jeff Example",
      orgUuid: "33333333-3333-4333-8333-333333333333",
      orgName: "jeff@example.com's Organization",
      plan: "Max 20x",
    });
  });

  it("honours a preferred org when it is a chat org", () => {
    const two = structuredClone(bootstrap);
    two.account.memberships.push({
      organization: { uuid: "44444444-4444-4444-8444-444444444444", name: "Team", capabilities: ["chat", "raven"], rate_limit_tier: null },
    });
    expect(parseIdentity(two, "44444444-4444-4444-8444-444444444444")).toMatchObject({ orgName: "Team", plan: "Team" });
  });

  it("rejects a response without account uuid or email", () => {
    expect(() => parseIdentity({ account: { uuid: "x" } })).toThrow(/identity/i);
    expect(() => parseIdentity(null)).toThrow(/identity/i);
  });
});

describe("planLabel", () => {
  it.each([
    [{ rateLimitTier: "default_claude_max_20x" }, "Max 20x"],
    [{ rateLimitTier: "default_claude_max_5x" }, "Max 5x"],
    [{ capabilities: ["chat", "claude_max"] }, "Max"],
    [{ capabilities: ["chat", "raven"] }, "Team"],
    [{ capabilities: ["chat", "enterprise"] }, "Enterprise"],
    [{ capabilities: ["chat", "claude_pro"] }, "Pro"],
    [{ capabilities: ["chat"] }, "Free"],
  ])("%j → %s", (org, label) => expect(planLabel(org)).toBe(label));
});

describe("whoAmI", () => {
  it("calls the identity endpoint with cookies", async () => {
    const fetchImpl = vi.fn(async () => json(200, bootstrap));
    await whoAmI({ fetchImpl });
    expect(fetchImpl).toHaveBeenCalledWith("https://claude.ai/api/bootstrap", expect.objectContaining({ credentials: "include" }));
  });

  it("maps 401/403 to AuthError and other failures to NetworkError", async () => {
    await expect(whoAmI({ fetchImpl: async () => json(401, {}) })).rejects.toBeInstanceOf(AuthError);
    await expect(whoAmI({ fetchImpl: async () => json(403, {}) })).rejects.toBeInstanceOf(AuthError);
    await expect(whoAmI({ fetchImpl: async () => json(502, {}) })).rejects.toBeInstanceOf(NetworkError);
    await expect(whoAmI({ fetchImpl: async () => Promise.reject(new TypeError("offline")) })).rejects.toBeInstanceOf(NetworkError);
  });

  it("reports a 200 that isn't JSON (e.g. an HTML challenge page) as a NetworkError", async () => {
    const html = async () => new Response("<!doctype html><title>Just a moment…</title>", { status: 200, headers: { "content-type": "text/html" } });
    await expect(whoAmI({ fetchImpl: html })).rejects.toEqual(new NetworkError("claude.ai answered with a non-JSON body"));
    await expect(fetchUsageJson("org-1", html)).rejects.toBeInstanceOf(NetworkError);
  });
});

describe("fetchUsageJson", () => {
  it("fetches the org usage endpoint", async () => {
    const fetchImpl = vi.fn(async () => json(200, { five_hour: { utilization: 3 } }));
    expect(await fetchUsageJson("org-1", fetchImpl)).toEqual({ five_hour: { utilization: 3 } });
    expect(fetchImpl).toHaveBeenCalledWith("https://claude.ai/api/organizations/org-1/usage", expect.objectContaining({ credentials: "include" }));
  });

  it("throws AuthError on 401", async () => {
    await expect(fetchUsageJson("org-1", async () => json(401, {}))).rejects.toBeInstanceOf(AuthError);
  });
});

describe("resource helpers", () => {
  it("detects a 403/404 claude.ai API call about the page's resource", () => {
    const api = "https://claude.ai/api/organizations/org-a/artifacts/7f3c9a/versions";
    expect(isResourceMiss(api, 404, "7f3c9a")).toBe(true);
    expect(isResourceMiss(api, 403, "7f3c9a")).toBe(true);
    expect(isResourceMiss(api, 200, "7f3c9a")).toBe(false);
    expect(isResourceMiss(api, 404, "other")).toBe(false);
    expect(isResourceMiss("https://claude.ai/artifact/7f3c9a", 404, "7f3c9a")).toBe(false);
    expect(isResourceMiss("https://evil.example/api/7f3c9a", 404, "7f3c9a")).toBe(false);
    expect(isResourceMiss("not a url", 404, "7f3c9a")).toBe(false);
  });

  it("matches a UUID whatever its case in the API path", () => {
    const id = "0b1c2d3e-0000-4000-8000-00000000abcd";
    expect(isResourceMiss(`https://claude.ai/api/organizations/o/chat_conversations/${id.toUpperCase()}`, 404, id)).toBe(true);
  });

  it("retargets the organization segment", () => {
    expect(retargetOrg("https://claude.ai/api/organizations/org-a/chat_conversations/c1?x=1", "org-b")).toBe(
      "https://claude.ai/api/organizations/org-b/chat_conversations/c1?x=1",
    );
    expect(retargetOrg("https://claude.ai/api/artifacts/a1", "org-b")).toBe("https://claude.ai/api/artifacts/a1");
  });

  it("builds the login url and matches cookie domains", () => {
    expect(loginUrl()).toBe("https://claude.ai/login");
    expect(hostMatchesClaude(".claude.ai")).toBe(true);
    expect(hostMatchesClaude("claude.ai")).toBe(true);
    expect(hostMatchesClaude(".example.com")).toBe(false);
  });
});
