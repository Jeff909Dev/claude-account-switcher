import type { Prefs, RescueInfo, UiState } from "./types";

/** UI → background. */
export type Request =
  | { type: "getState" }
  | { type: "switch"; accountId: string }
  | { type: "addAccount:start"; targetAccountId?: string }
  | { type: "addAccount:cancel" }
  | { type: "addAccount:resolveMismatch"; addAsNew: boolean }
  | { type: "addAccount:dismiss" }
  | { type: "account:update"; accountId: string; patch: { label?: string; color?: number } }
  | { type: "account:remove"; accountId: string }
  | { type: "account:reorder"; order: string[] }
  | { type: "prefs:update"; patch: Partial<Prefs> }
  | { type: "rescue:get" }
  | { type: "rescue:openAs"; accountId: string; resourceKey: string };

/** Background → UI broadcasts. */
export type Push = { type: "state"; state: UiState } | { type: "rescue:show"; rescue: RescueInfo };

export type Reply<T = unknown> = { ok: true; data: T } | { ok: false; error: string };

export async function sendToBackground<T = unknown>(req: Request): Promise<T> {
  const reply = (await chrome.runtime.sendMessage(req)) as Reply<T> | undefined;
  if (!reply) throw new Error("No reply from the extension background");
  if (!reply.ok) throw new Error(reply.error);
  return reply.data;
}
