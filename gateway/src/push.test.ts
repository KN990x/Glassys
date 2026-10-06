import { access, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import YAML from "yaml";
import { defaultConfig } from "@glassys/protocol";
import { patchSecrets } from "./secrets.js";
import {
  assertPublicPushEndpoint,
  isPrivateAddress,
  notifyFromEvent,
  resetPushRunFlags,
  savePushSubscription,
  setPushLookupForTests,
  setPushSenderForTests,
} from "./push.js";

describe("push endpoint guard", () => {
  afterEach(() => setPushLookupForTests(null));

  it("classifies loopback, private, link-local and mapped addresses as private", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.1", "169.254.169.254", "::1", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "0.0.0.0"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    expect(isPrivateAddress("142.250.184.10")).toBe(false);
    expect(isPrivateAddress("2a00:1450:4003:80e::200a")).toBe(false);
  });

  it("rejects http, private literals and hosts that resolve to the LAN", async () => {
    setPushLookupForTests(async (host) => [{ address: host === "evil.example" ? "192.168.1.10" : "142.250.184.10" }]);
    await expect(assertPublicPushEndpoint("http://fcm.googleapis.com/x")).rejects.toThrow(/https/);
    await expect(assertPublicPushEndpoint("https://127.0.0.1:8787/api")).rejects.toThrow(/public/);
    await expect(assertPublicPushEndpoint("https://[::1]/x")).rejects.toThrow(/public/);
    await expect(assertPublicPushEndpoint("https://evil.example/x")).rejects.toThrow(/public/);
    await expect(assertPublicPushEndpoint("https://fcm.googleapis.com/fcm/send/abc")).resolves.toBeUndefined();
  });
});

describe("web push", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "glassys-push-"));
    process.env.GLASSYS_DATA_DIR = dir;
    const cfg = defaultConfig();
    cfg.session.notifyOnComplete = true;
    await writeFile(join(dir, "config.yaml"), YAML.stringify(cfg), "utf8");
    await patchSecrets({
      vapid: { publicKey: "pub", privateKey: "priv", subject: "mailto:operator@localhost" },
    });
    resetPushRunFlags();
    setPushLookupForTests(async () => [{ address: "142.250.184.10" }]);
  });

  afterEach(() => {
    setPushSenderForTests(null);
    setPushLookupForTests(null);
  });

  it("does not send when there are no subscriptions", async () => {
    const calls: unknown[] = [];
    setPushSenderForTests(async () => {
      calls.push(1);
      return { statusCode: 201 };
    });
    await notifyFromEvent({ type: "run.done" });
    expect(calls).toHaveLength(0);
  });

  it("sends terminal events and one denied tool per run, and drops 410 subs", async () => {
    await savePushSubscription({ endpoint: "https://push.example/a", keys: { p256dh: "p", auth: "a" } });
    await savePushSubscription({ endpoint: "https://push.example/gone", keys: { p256dh: "p", auth: "a" } });
    const sent: Array<{ endpoint: string; body: string }> = [];
    setPushSenderForTests(async (sub, payload) => {
      sent.push({ endpoint: sub.endpoint, body: payload });
      return { statusCode: sub.endpoint.endsWith("gone") ? 410 : 201 };
    });
    await notifyFromEvent({ type: "run.start", runId: "r1" });
    await notifyFromEvent({ type: "tool.end", callId: "c1", ok: false, denied: true, kind: "write" });
    await notifyFromEvent({ type: "tool.end", callId: "c2", ok: false, denied: true, kind: "write" });
    await notifyFromEvent({ type: "run.done" });
    const titles = sent.map((s) => JSON.parse(s.body) as { body: string });
    expect(sent.filter((s) => s.endpoint.endsWith("/a") && JSON.parse(s.body).body.includes("denied"))).toHaveLength(1);
    expect(titles.some((t) => t.body.includes("finished"))).toBe(true);
    sent.length = 0;
    await notifyFromEvent({ type: "run.error", message: "boom" });
    expect(sent.every((s) => s.endpoint !== "https://push.example/gone")).toBe(true);
  });

  it("uses Spanish copy when locale is es", async () => {
    const cfg = defaultConfig();
    cfg.session.notifyOnComplete = true;
    cfg.space.locale = "es";
    await writeFile(join(dir, "config.yaml"), YAML.stringify(cfg), "utf8");
    await savePushSubscription({ endpoint: "https://push.example/es", keys: { p256dh: "p", auth: "a" } });
    const sent: string[] = [];
    setPushSenderForTests(async (_sub, payload) => {
      sent.push(payload);
      return { statusCode: 201 };
    });
    await notifyFromEvent({ type: "run.done" });
    expect(sent.some((body) => body.includes("terminado"))).toBe(true);
  });
});

describe("push on streamed events", () => {
  it("does no I/O for events that never notify", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glassys-push-io-"));
    process.env.GLASSYS_DATA_DIR = dir;
    await notifyFromEvent({ type: "text.delta", text: "a" });
    await notifyFromEvent({ type: "thinking.delta", text: "b" });
    // loadConfig() would have created config.yaml on its first read.
    await expect(access(join(dir, "config.yaml"))).rejects.toThrow();
  });
});
