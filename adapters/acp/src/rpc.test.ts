import { describe, expect, it } from "vitest";
import { JsonRpcStdio, headerEnd } from "./rpc.js";

describe("headerEnd", () => {
  it("finds the blank line with CRLF, bare LF, and the mixed form left by an NDJSON re-insert", () => {
    expect(headerEnd(Buffer.from("Content-Length: 2\r\n\r\n{}"))).toEqual({ end: 18, bodyStart: 21 });
    expect(headerEnd(Buffer.from("Content-Length: 2\n\n{}"))).toEqual({ end: 17, bodyStart: 19 });
    expect(headerEnd(Buffer.from("Content-Length: 2\n\r\n{}"))).toEqual({ end: 17, bodyStart: 20 });
    expect(headerEnd(Buffer.from("Content-Length: 2\r\n"))).toBeNull();
  });
});

describe("JsonRpcStdio lifecycle", () => {
  it("times out a request the child never answers", async () => {
    const rpc = new JsonRpcStdio(process.execPath, ["-e", "setInterval(() => {}, 1000)"], process.cwd());
    await expect(rpc.request("initialize", {}, 100)).rejects.toThrow(/timed out/);
    await rpc.close();
  });

  it("kills a child that ignores SIGTERM and rejects later requests", async () => {
    const rpc = new JsonRpcStdio(
      process.execPath,
      ["-e", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"],
      process.cwd(),
    );
    await new Promise((r) => setTimeout(r, 150));
    await rpc.close();
    expect(rpc.alive).toBe(false);
    await expect(rpc.request("session/prompt", {})).rejects.toThrow(/exited/);
  }, 10_000);
});

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

  it("speaks NDJSON first, as ACP agents never write before initialize", async () => {
    const rpc = new JsonRpcStdio(
      process.execPath,
      [
        "-e",
        `
        const rl = require("readline").createInterface({ input: process.stdin });
        rl.on("line", (line) => {
          const msg = JSON.parse(line);
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { ok: true } }) + "\\n");
        });
        `,
      ],
      process.cwd(),
    );
    await expect(rpc.request("initialize", {}, 3000)).resolves.toEqual({ ok: true });
    await rpc.close();
  });

  it("switches to Content-Length framing when the agent writes it", async () => {
    const rpc = new JsonRpcStdio(
      process.execPath,
      [
        "-e",
        `
        const frame = (obj) => {
          const payload = Buffer.from(JSON.stringify(obj));
          process.stdout.write("Content-Length: " + payload.length + "\\r\\n\\r\\n");
          process.stdout.write(payload);
        };
        frame({ jsonrpc: "2.0", method: "hello", params: {} });
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
          frame({ jsonrpc: "2.0", id: msg.id, result: { ok: true } });
        });
        `,
      ],
      process.cwd(),
    );
    const greeted = new Promise((resolve) => rpc.onNotification("hello", resolve));
    await greeted;
    await expect(rpc.request("initialize", {}, 3000)).resolves.toEqual({ ok: true });
    await rpc.close();
  });

  it("answers an unknown agent request with method-not-found", async () => {
    const rpc = new JsonRpcStdio(
      process.execPath,
      [
        "-e",
        `
        process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: 7, method: "x/unknown", params: {} }) + "\\n");
        const rl = require("readline").createInterface({ input: process.stdin });
        rl.on("line", (line) => {
          const msg = JSON.parse(line);
          if (msg.id === 7) process.stdout.write(JSON.stringify({ jsonrpc: "2.0", method: "seen", params: msg.error }) + "\\n");
        });
        `,
      ],
      process.cwd(),
    );
    const seen = await new Promise((resolve) => rpc.onNotification("seen", resolve));
    expect(seen).toMatchObject({ code: -32601 });
    await rpc.close();
  });
});

describe("JsonRpcStdio large frames", () => {
  it("reads a multi-megabyte NDJSON message that arrives in many chunks", async () => {
    const rpc = new JsonRpcStdio(
      process.execPath,
      [
        "-e",
        `
        const rl = require("readline").createInterface({ input: process.stdin });
        rl.on("line", (line) => {
          const msg = JSON.parse(line);
          process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { blob: "x".repeat(8 * 1024 * 1024) } }) + "\\n");
        });
        `,
      ],
      process.cwd(),
    );
    const started = Date.now();
    const result = (await rpc.request("big", {}, 10_000)) as { blob: string };
    expect(result.blob.length).toBe(8 * 1024 * 1024);
    expect(Date.now() - started).toBeLessThan(5_000);
    await rpc.close();
  }, 15_000);
});
