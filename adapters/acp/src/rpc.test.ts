import { describe, expect, it } from "vitest";
import { JsonRpcStdio } from "./rpc.js";

describe("JsonRpcStdio stderr", () => {
  it("drains child stderr so a noisy process cannot fill the pipe", async () => {
    const rpc = new JsonRpcStdio(
      process.execPath,
      ["-e", "process.stderr.write('x'.repeat(70000)); setInterval(() => {}, 1000)"],
      process.cwd(),
    );
    await new Promise((r) => setTimeout(r, 200));
    expect(rpc.child.killed).toBe(false);
    await rpc.close();
  });

  it("includes stderr in the exit error", async () => {
    const rpc = new JsonRpcStdio(
      process.execPath,
      ["-e", "process.stderr.write('agent boom'); process.exit(1)"],
      process.cwd(),
    );
    await expect(rpc.request("initialize", {})).rejects.toThrow(/agent boom/);
    await rpc.close();
  });
});
