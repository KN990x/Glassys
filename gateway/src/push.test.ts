import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import YAML from "yaml";
import { defaultConfig } from "@glassys/protocol";
import { patchSecrets } from "./secrets.js";
import { notifyFromEvent, resetPushRunFlags, savePushSubscription, setPushSenderForTests } from "./push.js";

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
  });

  afterEach(() => {
    setPushSenderForTests(null);
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
});
