import { describe, expect, it, vi } from "vitest";

/* A scripted Claude process: each prompt it reads yields the messages queued for that turn. */
const turns: unknown[][] = [];
let interrupted = 0;

vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: ({ prompt }: { prompt: AsyncIterable<unknown> }) => {
    const out = (async function* () {
      for await (const _msg of prompt) {
        void _msg;
        const turn = turns.shift() ?? [];
        for (const m of turn) {
          if (m === "END") return;
          await new Promise((r) => setTimeout(r, 30));
          yield m;
        }
      }
    })();
    return {
      interrupt: async () => {
        interrupted += 1;
      },
      close: () => undefined,
      [Symbol.asyncIterator]: () => out,
    };
  },
}));

const { claudeAdapter } = await import("./index.js");
const opts = { cwd: "/tmp", model: "sonnet", modelParams: [], storeDir: "/tmp/s", options: {} };
const text = (t: string) => ({
  type: "assistant",
  session_id: "s1",
  message: { content: [{ type: "text", text: t }] },
});
const result = (sub = "success") => ({ type: "result", subtype: sub, session_id: "s1" });

describe("claude session", () => {
  it("drains a cancelled turn up to its result, so the next turn gets its own answer", async () => {
    turns.push([text("first a"), text("first b"), result("error_during_execution")], [text("second"), result()]);
    const session = await claudeAdapter.create(opts);
    const firstEvents: unknown[] = [];
    const first = await session.send("one", (e) => firstEvents.push(e));
    await new Promise((r) => setTimeout(r, 40));
    await first.cancel();
    expect(await first.wait()).toBe("cancelled");
    expect(interrupted).toBeGreaterThan(0);

    const secondText: string[] = [];
    const second = await session.send("two", (e) => {
      if ((e as { type: string }).type === "text.delta") secondText.push((e as { text: string }).text);
    });
    expect(await second.wait()).toBe("finished");
    expect(secondText.join("")).toContain("second");
    expect(secondText.join("")).not.toContain("first");
    expect(session.closed).toBe(false);
    await session.dispose();
  });

  it("reports the session closed when the Claude process ends", async () => {
    turns.push(["END"]);
    const session = await claudeAdapter.create(opts);
    const run = await session.send("one", () => undefined);
    expect(await run.wait()).toBe("finished");
    expect(session.closed).toBe(true);
  });
});
