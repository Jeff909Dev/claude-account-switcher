import http from "node:http";

export const FAKE_PORT = 4319;
export const FAKE_ORIGIN = `http://localhost:${FAKE_PORT}`;

interface FakeUser {
  uuid: string;
  email: string;
  name: string;
  org: string;
  tier: string | null;
  caps: string[];
  usage: unknown;
}

const USERS: Record<string, FakeUser> = {
  "sk-work": {
    uuid: "aaaaaaaa-0000-4000-8000-000000000001", email: "you@work.example", name: "You at work", org: "org-work",
    tier: "default_claude_max_20x", caps: ["chat", "claude_max"],
    usage: { limits: [
      { kind: "session", percent: 25, resets_at: "2026-10-01T22:30:00Z", scope: null },
      { kind: "weekly_all", percent: 54, resets_at: "2026-10-06T04:00:00Z", scope: null },
      { kind: "weekly_scoped", percent: 64, resets_at: "2026-10-06T04:00:00Z", scope: { model: { display_name: "Fable" } } },
    ] },
  },
  "sk-personal": {
    uuid: "bbbbbbbb-0000-4000-8000-000000000002", email: "you@personal.example", name: "You at home", org: "org-personal",
    tier: null, caps: ["chat", "claude_pro"],
    usage: { five_hour: { utilization: 10, resets_at: "2026-10-01T23:00:00Z" }, seven_day: { utilization: 20, resets_at: "2026-10-06T04:00:00Z" } },
  },
};
const ARTIFACT_OWNER: Record<string, string> = { "personal-only": "org-personal" };

function cookies(req: http.IncomingMessage): Record<string, string> {
  return Object.fromEntries((req.headers.cookie ?? "").split(/;\s*/).filter(Boolean).map((p) => {
    const i = p.indexOf("=");
    return [p.slice(0, i), decodeURIComponent(p.slice(i + 1))];
  }));
}

const page = (body: string) => `<!doctype html><html><head><meta charset="utf-8"><meta name="color-scheme" content="light dark"><title>fake claude</title></head><body style="font-family: Georgia, serif">${body}</body></html>`;

export function startFakeClaude(port = FAKE_PORT): Promise<http.Server> {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);
    const jar = cookies(req);
    const user = USERS[jar.sessionKey ?? ""];
    const headers: Record<string, string | string[]> = {};
    if (!jar.cf_clearance) headers["set-cookie"] = [`cf_clearance=cf-${Math.random().toString(36).slice(2)}; Path=/; HttpOnly; SameSite=Lax`];
    const send = (status: number, type: string, body: string, extra: Record<string, string | string[]> = {}) => {
      res.writeHead(status, { "content-type": type, ...headers, ...extra });
      res.end(body);
    };
    const json = (status: number, body: unknown) => send(status, "application/json", JSON.stringify(body));

    if (url.pathname === "/login") {
      return send(200, "text/html", page(`<h1>Log in</h1><a id="as-work" href="/fake/login?as=work">Continue as work</a> <a id="as-personal" href="/fake/login?as=personal">Continue as personal</a>`));
    }
    if (url.pathname === "/fake/login") {
      const who = url.searchParams.get("as") === "personal" ? "sk-personal" : "sk-work";
      const set = [`sessionKey=${who}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`, `lastActiveOrg=${USERS[who]!.org}; Path=/; SameSite=Lax; Max-Age=86400`];
      return send(302, "text/plain", "", { location: "/new", "set-cookie": [...((headers["set-cookie"] as string[]) ?? []), ...set] });
    }
    if (url.pathname === "/api/bootstrap") {
      if (!user) return json(401, { error: "unauthorized" });
      return json(200, { account: { uuid: user.uuid, email_address: user.email, full_name: user.name, memberships: [
        { organization: { uuid: user.org, name: `${user.name}'s org`, capabilities: user.caps, rate_limit_tier: user.tier } },
      ] } });
    }
    const usage = /^\/api\/organizations\/([^/]+)\/usage$/.exec(url.pathname);
    if (usage) {
      if (!user) return json(401, {});
      return usage[1] === user.org ? json(200, user.usage) : json(403, {});
    }
    const artifactApi = /^\/api\/organizations\/([^/]+)\/artifacts\/([^/]+)$/.exec(url.pathname);
    if (artifactApi) {
      if (!user) return json(401, {});
      return artifactApi[1] === user.org && ARTIFACT_OWNER[artifactApi[2]!] === user.org ? json(200, { id: artifactApi[2] }) : json(404, { error: "not_found" });
    }
    if (url.pathname === "/new") return send(200, "text/html", page(`<p id="who">${user ? `Signed in as ${user.email}` : "Signed out"}</p>`));
    const artifactPage = /^\/artifact\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
    if (artifactPage) {
      const id = artifactPage[1]!;
      const org = user?.org ?? "none";
      return send(200, "text/html", page(`<p id="artifact">Loading…</p><script>
        fetch("/api/organizations/${org}/artifacts/${id}").then(r => {
          document.getElementById("artifact").textContent = r.ok ? "Artifact ${id}" : "Not found";
        });
      </script>`));
    }
    return send(404, "text/plain", "not found");
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}
