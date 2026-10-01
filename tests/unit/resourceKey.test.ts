import { describe, expect, it } from "vitest";
import { parseResourceUrl } from "../../src/shared/resourceKey";

const U = "0b1c2d3e-0000-4000-8000-000000000000";

describe("parseResourceUrl", () => {
  it.each([
    ["https://claude.ai/artifact/7f3c9a?x=1#h", { kind: "artifact", id: "7f3c9a", key: "artifact:7f3c9a" }],
    [`https://claude.ai/code/artifact/${U}`, { kind: "codeArtifact", id: U, key: `codeArtifact:${U}` }],
    [`https://claude.ai/chat/${U}/`, { kind: "chat", id: U, key: `chat:${U}` }],
    [`https://claude.ai/project/${U.toUpperCase()}`, { kind: "project", id: U, key: `project:${U}` }],
    [`https://claude.ai/chat/${U.toUpperCase()}`, { kind: "chat", id: U, key: `chat:${U}` }],
    ["https://claude.ai/artifact/AbC9", { kind: "artifact", id: "AbC9", key: "artifact:AbC9" }],
    ["https://claude.ai/public/artifacts/abc", null],
    ["https://claude.ai/new", null],
    ["https://claude.ai/chat/not-a-uuid", null],
    ["https://evil.example/artifact/abc", null],
    ["not a url", null],
  ])("%s", (url, expected) => expect(parseResourceUrl(url)).toEqual(expected));
});
