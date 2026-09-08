import { spawn, type ChildProcess } from "node:child_process";
import { asRecord } from "@glassys/adapter-contract";

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

export type RpcHandler = (params: unknown) => Promise<unknown> | unknown;

function indexOfCrlfCrlf(buf: Buffer): number {
  for (let i = 0; i + 3 < buf.length; i++) {
    if (buf[i] === 13 && buf[i + 1] === 10 && buf[i + 2] === 13 && buf[i + 3] === 10) return i;
  }
  return -1;
}

export class JsonRpcStdio {
  private nextId = 1;
  private buf = Buffer.alloc(0);
  private framing: "unknown" | "lsp" | "ndjson" = "unknown";
  private stderrTail = "";
  private pending = new Map<number | string, Pending>();
  private notifications = new Map<string, Array<(params: unknown) => void>>();
  private methods = new Map<string, RpcHandler>();
  readonly child: ChildProcess;

  constructor(command: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv) {
    this.child = spawn(command, args, { cwd, stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, ...env } });
    this.child.stdout?.on("data", (chunk: Buffer) => this.onData(chunk));
    this.child.stderr?.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      this.stderrTail = (this.stderrTail + text).slice(-8_192);
    });
    this.child.on("error", (err) => this.failAll(err));
    this.child.on("close", () => {
      const tail = this.stderrTail.trim();
      this.failAll(new Error(tail ? `ACP process exited: ${tail.slice(-2000)}` : "ACP process exited"));
    });
  }

  handle(method: string, fn: RpcHandler) {
    this.methods.set(method, fn);
  }

  onNotification(method: string, fn: (params: unknown) => void): () => void {
    const list = this.notifications.get(method) ?? [];
    list.push(fn);
    this.notifications.set(method, list);
    return () => {
      const next = (this.notifications.get(method) ?? []).filter((x) => x !== fn);
      this.notifications.set(method, next);
    };
  }

  request(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++;
    this.send({ jsonrpc: "2.0", id, method, params });
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  notify(method: string, params?: unknown) {
    this.send({ jsonrpc: "2.0", method, params });
  }

  async close() {
    this.failAll(new Error("closed"));
    this.child.kill("SIGTERM");
  }

  private send(msg: unknown) {
    const json = JSON.stringify(msg);
    if (this.framing === "ndjson") {
      this.child.stdin?.write(`${json}\n`);
      return;
    }
    const payload = Buffer.from(json, "utf8");
    this.child.stdin?.write(`Content-Length: ${payload.length}\r\n\r\n`);
    this.child.stdin?.write(payload);
  }

  private onData(chunk: Buffer) {
    this.buf = Buffer.concat([this.buf, chunk]);
    this.consume();
  }

  private consume() {
    for (;;) {
      if (this.framing === "unknown") {
        const head = this.buf.subarray(0, Math.min(this.buf.length, 32)).toString("utf8");
        if (/^\s*Content-Length:/i.test(head)) this.framing = "lsp";
        else if (this.buf.includes(0x0a)) this.framing = "ndjson";
        else return;
      }
      if (this.framing === "lsp") {
        const headerEnd = indexOfCrlfCrlf(this.buf);
        if (headerEnd < 0) return;
        const header = this.buf.subarray(0, headerEnd).toString("utf8");
        const match = header.match(/Content-Length:\s*(\d+)/i);
        if (!match) {
          this.framing = "ndjson";
          continue;
        }
        const len = Number(match[1]);
        const bodyStart = headerEnd + 4;
        if (this.buf.length < bodyStart + len) return;
        const body = this.buf.subarray(bodyStart, bodyStart + len).toString("utf8");
        this.buf = this.buf.subarray(bodyStart + len);
        try {
          this.onMessage(JSON.parse(body) as unknown);
        } catch {
          /* ignore */
        }
        continue;
      }
      const nl = this.buf.indexOf(0x0a);
      if (nl < 0) return;
      const line = this.buf.subarray(0, nl).toString("utf8").replace(/\r$/, "");
      this.buf = this.buf.subarray(nl + 1);
      if (!line.trim()) continue;
      if (/^Content-Length:/i.test(line)) {
        this.framing = "lsp";
        this.buf = Buffer.concat([Buffer.from(`${line}\n`, "utf8"), this.buf]);
        continue;
      }
      try {
        this.onMessage(JSON.parse(line) as unknown);
      } catch {
        /* ignore */
      }
    }
  }

  private onMessage(raw: unknown) {
    const rec = asRecord(raw);
    if (!rec) return;
    if (rec.method && rec.id !== undefined) {
      void this.onRequest(rec);
      return;
    }
    if (rec.method && rec.id === undefined) {
      for (const fn of this.notifications.get(String(rec.method)) ?? []) fn(rec.params);
      return;
    }
    if (rec.id !== undefined) {
      const pending = this.pending.get(rec.id as number | string);
      if (!pending) return;
      this.pending.delete(rec.id as number | string);
      if (rec.error) {
        const err = asRecord(rec.error);
        pending.reject(new Error(typeof err?.message === "string" ? err.message : "ACP error"));
      } else pending.resolve(rec.result);
    }
  }

  private async onRequest(rec: Record<string, unknown>) {
    const method = String(rec.method);
    const id = rec.id;
    const fn = this.methods.get(method);
    try {
      const result = fn ? await fn(rec.params) : {};
      this.send({ jsonrpc: "2.0", id, result: result ?? {} });
    } catch (err) {
      this.send({
        jsonrpc: "2.0",
        id,
        error: { code: -32000, message: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  private failAll(err: Error) {
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }
}
