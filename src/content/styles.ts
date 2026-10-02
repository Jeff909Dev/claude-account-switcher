/** Lives inside our shadow root; `font-family: inherit` picks up claude.ai's own typefaces. */
export const CONTENT_CSS = `
:host { all: initial; font-family: inherit; font-size: 13px; line-height: 1.4; color-scheme: light dark;
  --cas-bg: #faf9f5; --cas-surface: #f5f4ed; --cas-surface-2: #f0eee6; --cas-border: rgba(31,30,29,.14);
  --cas-text: #141413; --cas-muted: #73726c; --cas-claude: #c96442; --cas-err: #c4314b; }
@media (prefers-color-scheme: dark) { :host { --cas-bg: #262624; --cas-surface: #1f1e1d; --cas-surface-2: #30302e;
  --cas-border: rgba(222,220,209,.14); --cas-text: #faf9f5; --cas-muted: #9c9a92; --cas-claude: #d97757; --cas-err: #ff6b80; } }
[hidden] { display: none !important; }
.cas-switch { position: fixed; z-index: 2147483646; color: var(--cas-text); font: inherit; }
.pill { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 8px 0 4px; border-radius: 14px;
  border: 0.5px solid var(--cas-border); background: var(--cas-surface); color: inherit; font: inherit; font-size: 12px; cursor: pointer; }
.pill:hover { background: var(--cas-surface-2); }
.avatar { display: inline-grid; place-items: center; flex: none; width: 20px; height: 20px; border-radius: 50%; color: #fff; font-size: 10px; font-weight: 600; }
.menu { position: absolute; bottom: 34px; left: 0; min-width: 240px; padding: 4px; border-radius: 12px; background: var(--cas-bg);
  border: 0.5px solid var(--cas-border); box-shadow: 0 12px 32px rgba(0,0,0,.25); }
.item { display: grid; grid-template-columns: 20px 1fr auto; gap: 8px; align-items: center; width: 100%; padding: 6px 8px; border: 0;
  border-radius: 8px; background: transparent; color: inherit; font: inherit; font-size: 12px; text-align: left; cursor: pointer; }
.item:hover { background: var(--cas-surface-2); }
.item .email { display: block; color: var(--cas-muted); font-size: 11px; }
.item .err { display: block; color: var(--cas-err); font-size: 11px; }
.check { color: var(--cas-claude); }
.kbd { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 10px; color: var(--cas-muted); }
.sep { height: 0.5px; background: var(--cas-border); margin: 4px 0; }
.hint { padding: 4px 8px; font-size: 10px; color: var(--cas-muted); }
.banner { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); z-index: 2147483647; width: min(520px, calc(100vw - 32px));
  padding: 10px 12px; border-radius: 12px; background: var(--cas-bg); color: var(--cas-text); border: 0.5px solid var(--cas-border);
  box-shadow: 0 12px 32px rgba(0,0,0,.25); font: inherit; font-size: 13px; }
.banner .title { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.banner .muted { color: var(--cas-muted); font-size: 12px; }
.actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.btn { height: 26px; padding: 0 10px; border-radius: 8px; border: 0.5px solid var(--cas-border); background: var(--cas-surface-2);
  color: inherit; font: inherit; font-size: 12px; cursor: pointer; }
.btn.primary { background: var(--cas-claude); border-color: transparent; color: #fff; }
.btn[disabled] { opacity: .5; cursor: default; }
.close { border: 0; background: transparent; color: var(--cas-muted); cursor: pointer; font: inherit; font-size: 16px; }
.spinner { width: 12px; height: 12px; border-radius: 50%; border: 2px solid var(--cas-border); border-top-color: var(--cas-claude); animation: cas-spin .8s linear infinite; }
@keyframes cas-spin { to { transform: rotate(360deg); } }
.err { color: var(--cas-err); }
`;
