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

  it("round-trips JSON-RPC with Content-Length framing", async () => {
    const rpc = new JsonRpcStdio(
      process.execPath,
      [
        "-e",
        `
        let buf = Buffer.alloc(0);
        process.stdin.on("data", (chunk) => {
          buf = Buffer.concat([buf, chunk]);
          const header = buf.toString("utf8");
          const m = header.match(/Content-Length:\\s*(\\d+)/i);
          const split = buf.indexOf(Buffer.from("\\r\\n\\r\\n"));
          if (!m || split < 0) return;
          const len = Number(m[1]);
          const start = split + 4;
          if (buf.length < start + len) return;
          const msg = JSON.parse(buf.subarray(start, start + len).toString("utf8"));
          const res = JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { ok: true } });
          const payload = Buffer.from(res);
          process.stdout.write("Content-Length: " + payload.length + "\\r\\n\\r\\n");
          process.stdout.write(payload);
        });
        `,
      ],
      process.cwd(),
    );
    await expect(rpc.request("initialize", {})).resolves.toEqual({ ok: true });
    await rpc.close();
  });
});
