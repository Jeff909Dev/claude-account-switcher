import { sendToBackground } from "../shared/messages";
import { boot } from "./boot";

void boot({
  doc: document,
  win: window,
  send: (req) => sendToBackground(req),
  onMessage: (cb) =>
    chrome.runtime.onMessage.addListener((msg: unknown) => {
      cb(msg);
      return false;
    }),
});
