/** Build-time origin. Production builds use claude.ai; the e2e build points at a local fake. */
declare const __CLAUDE_ORIGIN__: string | undefined;

export const CLAUDE_ORIGIN: string = typeof __CLAUDE_ORIGIN__ === "string" ? __CLAUDE_ORIGIN__ : "https://claude.ai";
const parsed = new URL(CLAUDE_ORIGIN);
export const CLAUDE_HOST: string = parsed.hostname;
/** Match pattern for every claude.ai page (a pattern without port matches any port). */
export const CLAUDE_TAB_PATTERN = `${parsed.protocol}//${parsed.hostname}/*`;
export const CLAUDE_API_PATTERN = `${parsed.protocol}//${parsed.hostname}/api/*`;
