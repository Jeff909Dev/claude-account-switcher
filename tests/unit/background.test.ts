import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROBE_RULE_BASE } from "../../src/background/rescue";
import { BADGE_CRIT, USAGE_ALARM, USAGE_KEY } from "../../src/background/usage";
import type { Push } from "../../src/shared/messages";
import type { UiState, UsageSnapshot } from "../../src/shared/types";
import { browserAs, createHarness, identityForSession, saveAccount, type Harness } from "./harness";

const flush = () => new Promise((r) => setTimeout(r, 0));

/** The service worker entry (src/background/index.ts) wired against the chrome fake and a fake claude.ai fetch. */
describe("service worker", () => {
  let h: Harness;
  let usagePercent: Record<string, number | null>; // by org; null → claude.ai answers 500
  let fetchMock: ReturnType<typeof vi.fn<(input: string) => Promise<Response>>>;

  /** claude.ai as the worker's fetch sees it: identity from the browser's sessionKey; artifact 7f3c lives in org-b. */
  async function fakeClaude(input: string): Promise<Response> {
    const url = new URL(input);
    if (url.pathname.includes("/artifacts/")) return new Response("{}", { status: url.pathname.includes("/org-b/") ? 200 : 404 });
    const [c] = await h.fake.api.cookies.getAll({ name: "sessionKey" });
    const who = identityForSession(c?.value);
    if (!who) return new Response("{}", { status: 401 });
    if (url.pathname === "/api/bootstrap") {
      const organization = { uuid: who.orgUuid, name: who.orgName, capabilities: ["chat"] };
      return Response.json({ account: { uuid: who.accountUuid, email_address: who.email, full_name: who.name, memberships: [{ organization }] } });
    }
    const percent = usagePercent[who.orgUuid];
    if (url.pathname === `/api/organizations/${who.orgUuid}/usage` && typeof percent === "number") {
      return Response.json({ five_hour: { utilization: percent, resets_at: null } });
    }
    return new Response("{}", { status: 500 });
  }

  async function startWorker(): Promise<void> {
    vi.resetModules();
    await import("../../src/background/index");
  }

  const send = (msg: unknown) => h.fake.api.runtime.sendMessage(msg);

  /** A message from the content script in `tabId`, as Chrome delivers it to the worker. */
  function sendFromTab(tabId: number, msg: unknown): Promise<unknown> {
    return new Promise((resolve) => {
      const kept = h.fake.api.runtime.onMessage.emit(msg, { tab: { id: tabId } }, resolve);
      if (!kept.includes(true)) resolve(undefined);
    });
  }

  async function usageOf(accountId: string): Promise<UsageSnapshot | undefined> {
    const got = await h.fake.chrome.storage.local.get(USAGE_KEY);
    return (got[USAGE_KEY] as Record<string, UsageSnapshot> | undefined)?.[accountId];
  }

  async function uiState(): Promise<UiState> {
    return ((await send({ type: "getState" })) as { data: UiState }).data;
  }

  const usageFetches = () => fetchMock.mock.calls.filter(([url]) => url.endsWith("/usage"));

  function lastPushedState(): UiState | undefined {
    const pushes = h.fake.sentRuntimeMessages.filter((m): m is Extract<Push, { type: "state" }> => (m as Push).type === "state");
    return pushes[pushes.length - 1]?.state;
  }

  beforeEach(async () => {
    h = await createHarness();
    await saveAccount(h, "A");
    await saveAccount(h, "B");
    await browserAs(h, "sk-A");
    await h.store.setActive("acct-a");
    usagePercent = { "org-a": 40, "org-b": 92 };
    fetchMock = vi.fn(fakeClaude);
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(async () => {
    await flush(); // let the worker's fire-and-forget chains settle before the next test swaps the chrome fake
    vi.unstubAllGlobals();
  });

  it("sweeps probe rules left behind by a killed worker and schedules the 15-minute usage refresh", async () => {
    await h.fake.api.declarativeNetRequest.updateSessionRules({ addRules: [{ id: 7 }, { id: PROBE_RULE_BASE }, { id: PROBE_RULE_BASE + 4 }] });
    await startWorker();
    await vi.waitFor(() => expect(h.fake.sessionRules.map((r) => r.id)).toEqual([7]));
    await vi.waitFor(() => expect(h.fake.alarmMap.get(USAGE_ALARM)).toMatchObject({ periodInMinutes: 15 }));
  });

  it("answers UI requests and leaves other messages alone", async () => {
    await startWorker();
    expect(await send({ type: "getState" })).toMatchObject({ ok: true, data: { activeId: "acct-a" } });
    expect(await send({ type: "state", state: {} })).toBeUndefined();
    expect(await send({ type: "account:reorder" })).toMatchObject({ ok: false }); // malformed: answered, never left hanging
  });

  it("warns instead of leaving unhandled rejections when a broadcast fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    await startWorker();
    h.fake.api.tabs.query = async () => Promise.reject(new Error("tabs unavailable"));
    await send({ type: "switch", accountId: "acct-b" });
    await vi.waitFor(async () => expect((await h.store.load()).activeId).toBe("acct-b"));
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
  });

  it("restores the badge when the browser starts or the extension is installed or updated", async () => {
    const snapshot: UsageSnapshot = { limits: [{ kind: "session", label: "5h", percent: 95, resetsAt: null }], fetchedAt: 1 };
    await h.fake.chrome.storage.local.set({ [USAGE_KEY]: { "acct-a": snapshot } });
    await startWorker();
    h.fake.api.runtime.onStartup.emit();
    await vi.waitFor(() => expect(h.fake.badge.text).toBe("95%"));
    h.fake.badge.text = "";
    h.fake.api.runtime.onInstalled.emit();
    await vi.waitFor(() => expect(h.fake.badge.text).toBe("95%"));
  });

  describe("switch errors", () => {
    beforeEach(async () => {
      await saveAccount(h, "B", "sk-dead"); // claude.ai has revoked this session
      await startWorker();
      await send({ type: "switch", accountId: "acct-b" });
      await vi.waitFor(async () => expect((await uiState()).error).toMatch(/signed out/));
    });

    it("clear as soon as a new switch starts", async () => {
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      fetchMock.mockImplementation(async (input) => {
        const [c] = await h.fake.api.cookies.getAll({ name: "sessionKey" });
        if (c?.value === "sk-dead") await gate; // hold the second switch while it verifies B
        return fakeClaude(input);
      });
      await send({ type: "switch", accountId: "acct-b" });
      expect(await uiState()).toMatchObject({ switchingTo: "acct-b", error: null });
      release();
      await vi.waitFor(async () => expect((await uiState()).error).toMatch(/signed out/));
    });

    it("clear once the account is signed in again", async () => {
      await send({ type: "addAccount:start", targetAccountId: "acct-b" });
      await browserAs(h, "sk-B-new"); // claude.ai sets the new session; the worker's cookie listener completes the flow
      await vi.waitFor(async () => expect((await uiState()).add.phase).toBe("saved"));
      expect((await uiState()).error).toBeNull();
    });
  });

  it("after a successful switch, fetches the new account's usage, badges it (on by default) and broadcasts", async () => {
    await startWorker();
    expect(await send({ type: "switch", accountId: "acct-b" })).toEqual({ ok: true, data: null });
    await vi.waitFor(async () => expect((await usageOf("acct-b"))?.limits[0]?.percent).toBe(92));
    expect((await h.store.load()).activeId).toBe("acct-b");
    await vi.waitFor(() => expect(h.fake.badge).toEqual({ text: "92%", color: BADGE_CRIT }));
    await vi.waitFor(() => expect(lastPushedState()).toMatchObject({ activeId: "acct-b", lastSwitch: { accountId: "acct-b" }, usage: { "acct-b": {} } }));
  });

  it("after a switch the badge follows the new account even when its usage cannot be fetched", async () => {
    usagePercent = { "org-a": 95, "org-b": null };
    await startWorker();
    h.fake.api.alarms.onAlarm.emit({ name: USAGE_ALARM });
    await vi.waitFor(() => expect(h.fake.badge.text).toBe("95%"));
    await send({ type: "switch", accountId: "acct-b" });
    await vi.waitFor(async () => expect((await h.store.load()).activeId).toBe("acct-b"));
    await vi.waitFor(() => expect(h.fake.badge.text).toBe(""));
  });

  it("refreshes the active account's usage when the 15-minute alarm fires", async () => {
    await startWorker();
    h.fake.api.alarms.onAlarm.emit({ name: "something-else" });
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    h.fake.api.alarms.onAlarm.emit({ name: USAGE_ALARM });
    await vi.waitFor(async () => expect((await usageOf("acct-a"))?.limits[0]?.percent).toBe(40));
  });

  it("skips the alarm refresh while an add flow holds the browser", async () => {
    await startWorker();
    await send({ type: "addAccount:start" });
    h.fake.api.alarms.onAlarm.emit({ name: USAGE_ALARM });
    await flush();
    expect(usageFetches()).toEqual([]);
    expect(await usageOf("acct-a")).toBeUndefined();
  });

  it("shows the rescue banner on a miss and probes only once the startup sweep is done", async () => {
    await h.store.updatePrefs({ rescueProbe: true });
    let releaseSweep!: () => void;
    const sweepGate = new Promise<void>((r) => (releaseSweep = r));
    const dnr = h.fake.api.declarativeNetRequest;
    const getSessionRules = dnr.getSessionRules.bind(dnr);
    dnr.getSessionRules = async () => {
      await sweepGate;
      return getSessionRules();
    };
    const tab = h.fake.addTab("https://claude.ai/artifact/7f3c");
    await startWorker();

    h.fake.api.webRequest.onCompleted.emit({
      tabId: tab.id,
      url: "https://claude.ai/api/organizations/org-a/artifacts/7f3c",
      statusCode: 404,
      type: "xmlhttprequest",
    });
    await vi.waitFor(() =>
      expect(h.fake.sentToTabs).toContainEqual({ tabId: tab.id, message: expect.objectContaining({ type: "rescue:show" }) }),
    );

    const probed = sendFromTab(tab.id, { type: "rescue:probe", resourceKey: "artifact:7f3c" });
    await flush();
    expect(fetchMock).not.toHaveBeenCalled(); // the sweep would remove a fresh probe rule mid-request
    releaseSweep();
    expect(await probed).toEqual({ ok: true, data: [{ accountId: "acct-b", outcome: "found" }] });
  });
});
