import { sendToBackground, type Push } from "../shared/messages";
import type { UiState } from "../shared/types";
import { mount } from "./popup";

void (async () => {
  const root = document.getElementById("app");
  if (!root) return;
  let initial: UiState;
  try {
    initial = await sendToBackground<UiState>({ type: "getState" });
  } catch (e) {
    root.textContent = e instanceof Error ? e.message : "Could not reach the extension";
    root.className = "error";
    return;
  }
  const app = mount(root, (req) => sendToBackground(req), initial);
  chrome.runtime.onMessage.addListener((msg: unknown) => {
    const push = msg as Push | undefined;
    if (push?.type === "state") app.update(push.state);
    return false;
  });
  setInterval(() => app.update(app.current()), 5_000); // lets "Reloaded N tabs" and "as of" ages refresh
})();
