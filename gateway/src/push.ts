import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname } from "node:path";
import webpush from "web-push";
import type { ServerMessage } from "@glassys/protocol";
import { loadConfig } from "./config.js";
import { loadSecrets, patchSecrets, type VapidKeys } from "./secrets.js";
import { paths, log } from "./paths.js";
import { createMutex } from "./lock.js";

export interface PushSubscriptionRecord {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export const MAX_PUSH_SUBSCRIPTIONS = 20;

const PUSH_COPY = {
  en: {
    done: "Run finished",
    failed: "Run failed",
    cancelled: "Run cancelled",
    stalled: "Run looks stalled",
    denied: "A tool was denied",
  },
  es: {
    done: "Run terminado",
    failed: "El run falló",
    cancelled: "Run cancelado",
    stalled: "El run parece colgado",
    denied: "Se denegó una herramienta",
  },
} as const;

const withPushLock = createMutex();

let deniedThisRun = false;
let sender:
  | ((sub: PushSubscriptionRecord, payload: string, vapid: VapidKeys) => Promise<{ statusCode?: number }>)
  | null = null;

export function setPushSenderForTests(
  fn: ((sub: PushSubscriptionRecord, payload: string, vapid: VapidKeys) => Promise<{ statusCode?: number }>) | null,
): void {
  sender = fn;
}

export function resetPushRunFlags(): void {
  deniedThisRun = false;
}

async function readSubs(): Promise<PushSubscriptionRecord[]> {
  try {
    const raw = JSON.parse(await readFile(paths.pushSubscriptions(), "utf8")) as { subscriptions?: PushSubscriptionRecord[] };
    return Array.isArray(raw.subscriptions) ? raw.subscriptions.filter((s) => s && typeof s.endpoint === "string") : [];
  } catch {
    return [];
  }
}

async function writeSubs(subscriptions: PushSubscriptionRecord[]): Promise<void> {
  await mkdir(dirname(paths.pushSubscriptions()), { recursive: true });
  const tmp = `${paths.pushSubscriptions()}.tmp`;
  await writeFile(tmp, JSON.stringify({ subscriptions }, null, 2), "utf8");
  await rename(tmp, paths.pushSubscriptions());
}

export async function listPushSubscriptions(): Promise<PushSubscriptionRecord[]> {
  return withPushLock(readSubs);
}

export async function savePushSubscription(sub: PushSubscriptionRecord): Promise<void> {
  if (!sub.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) throw new Error("invalid subscription");
  await withPushLock(async () => {
    const cur = await readSubs();
    const next = cur.filter((s) => s.endpoint !== sub.endpoint);
    if (next.length >= MAX_PUSH_SUBSCRIPTIONS) throw new Error("Too many push subscriptions");
    next.push({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } });
    await writeSubs(next);
  });
}

export async function removePushSubscription(endpoint: string): Promise<void> {
  await withPushLock(async () => {
    const cur = await readSubs();
    await writeSubs(cur.filter((s) => s.endpoint !== endpoint));
  });
}

export function vapidSubject(publicUrl?: string): string {
  const url = publicUrl?.trim() || "";
  if (url.startsWith("https://")) return url;
  return "mailto:operator@localhost";
}

export async function ensureVapidKeys(): Promise<{ publicKey: string; subject: string }> {
  const secrets = await loadSecrets();
  if (secrets.vapid?.publicKey && secrets.vapid.privateKey) {
    return { publicKey: secrets.vapid.publicKey, subject: secrets.vapid.subject };
  }
  const generated = webpush.generateVAPIDKeys();
  const cfg = await loadConfig();
  const subject = vapidSubject(cfg.network.publicUrl);
  const vapid: VapidKeys = { publicKey: generated.publicKey, privateKey: generated.privateKey, subject };
  await patchSecrets({ vapid });
  return { publicKey: vapid.publicKey, subject: vapid.subject };
}

function payloadFor(event: ServerMessage, locale: string): { title: string; body: string } | null {
  const copy = locale.startsWith("es") ? PUSH_COPY.es : PUSH_COPY.en;
  switch (event.type) {
    case "run.done":
      return { title: "Glassys", body: copy.done };
    case "run.error":
      return { title: "Glassys", body: event.message || copy.failed };
    case "run.cancelled":
      return { title: "Glassys", body: copy.cancelled };
    case "run.stalled":
      return { title: "Glassys", body: copy.stalled };
    case "tool.end":
      if (event.denied) return { title: "Glassys", body: copy.denied };
      return null;
    default:
      return null;
  }
}

async function defaultSend(sub: PushSubscriptionRecord, payload: string, vapid: VapidKeys): Promise<{ statusCode?: number }> {
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: sub.keys },
      payload,
      { vapidDetails: { subject: vapid.subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey } },
    );
    return { statusCode: 201 };
  } catch (err) {
    const statusCode =
      err && typeof err === "object" && "statusCode" in err ? Number((err as { statusCode?: number }).statusCode) : undefined;
    return { statusCode };
  }
}

export async function notifyFromEvent(event: ServerMessage): Promise<void> {
  if (event.type === "run.start") {
    deniedThisRun = false;
    return;
  }
  const cfg = await loadConfig();
  const note = payloadFor(event, cfg.space.locale || "en");
  if (!note) return;
  if (event.type === "tool.end" && event.denied) {
    if (deniedThisRun) return;
    deniedThisRun = true;
  }
  if (!cfg.session.notifyOnComplete) return;
  const secrets = await loadSecrets();
  const vapid = secrets.vapid;
  if (!vapid?.publicKey || !vapid.privateKey) return;
  const subs = await listPushSubscriptions();
  if (!subs.length) return;
  const body = JSON.stringify(note);
  const send = sender ?? defaultSend;
  const gone: string[] = [];
  for (const sub of subs) {
    try {
      const res = await send(sub, body, vapid);
      if (res.statusCode === 404 || res.statusCode === 410) gone.push(sub.endpoint);
    } catch (err) {
      log("warn", "push send failed", { error: String(err) });
    }
  }
  for (const endpoint of gone) await removePushSubscription(endpoint);
}
