import { describe, expect, it } from "vitest";
import { createSerialQueue } from "../../src/background/serial";

describe("createSerialQueue", () => {
  it("runs calls strictly in order even when earlier ones are slower", async () => {
    const run = createSerialQueue();
    const log: string[] = [];
    const task = (name: string, ms: number) => run(async () => {
      log.push(`start ${name}`);
      await new Promise((r) => setTimeout(r, ms));
      log.push(`end ${name}`);
      return name;
    });
    const results = await Promise.all([task("a", 20), task("b", 1), task("c", 5)]);
    expect(results).toEqual(["a", "b", "c"]);
    expect(log).toEqual(["start a", "end a", "start b", "end b", "start c", "end c"]);
  });

  it("a rejected call does not poison later calls", async () => {
    const run = createSerialQueue();
    const failing = run(async () => { throw new Error("boom"); });
    const next = run(async () => "ok");
    await expect(failing).rejects.toThrow("boom");
    await expect(next).resolves.toBe("ok");
  });
});
