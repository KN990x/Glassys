import { mkdir, readFile } from "node:fs/promises";
import { lookup as dnsLookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { writeFileAtomic } from "./atomic.js";
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
  await writeFileAtomic(paths.pushSubscriptions(), JSON.stringify({ subscriptions }, null, 2));
}

export async function listPushSubscriptions(): Promise<PushSubscriptionRecord[]> {
  return withPushLock(readSubs);
}

const blocked = new BlockList();
for (const [net, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blocked.addSubnet(net, prefix, "ipv4");
}
for (const [net, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  blocked.addSubnet(net, prefix, "ipv6");
}

export function isPrivateAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return blocked.check(mapped[1]!, "ipv4");
  const family = isIP(address);
  if (family === 4) return blocked.check(address, "ipv4");
  if (family === 6) return blocked.check(address, "ipv6");
  return true;
}

type Lookup = (host: string) => Promise<Array<{ address: string }>>;
let lookupHost: Lookup = (host) => dnsLookup(host, { all: true, verbatim: true });

export function setPushLookupForTests(fn: Lookup | null): void {
  lookupHost = fn ?? ((host) => dnsLookup(host, { all: true, verbatim: true }));
}

/**
 * A push endpoint is a URL the gateway will POST to. Only public https hosts: anything else would
 * let a stored subscription make the gateway call services on the host or the LAN.
 */
export async function assertPublicPushEndpoint(endpoint: string): Promise<void> {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error("invalid subscription");
  }
  if (url.protocol !== "https:") throw new Error("push endpoint must be https");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [{ address: host }] : await lookupHost(host).catch(() => []);
  if (!addresses.length) throw new Error("push endpoint host does not resolve");
  if (addresses.some((a) => isPrivateAddress(a.address))) throw new Error("push endpoint must be a public host");
}

export async function savePushSubscription(sub: PushSubscriptionRecord): Promise<void> {
  if (!sub.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) throw new Error("invalid subscription");
  await assertPublicPushEndpoint(sub.endpoint);
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

const PUSH_SEND_TIMEOUT_MS = 10_000;

async function defaultSend(sub: PushSubscriptionRecord, payload: string, vapid: VapidKeys): Promise<{ statusCode?: number }> {
  try {
    await assertPublicPushEndpoint(sub.endpoint);
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: sub.keys },
      payload,
      {
        vapidDetails: { subject: vapid.subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey },
        timeout: PUSH_SEND_TIMEOUT_MS,
      },
    );
    return { statusCode: 201 };
  } catch (err) {
    const statusCode =
      err && typeof err === "object" && "statusCode" in err ? Number((err as { statusCode?: number }).statusCode) : undefined;
    return { statusCode };
  }
}

/** Every streamed event passes through here; only these can notify. */
function mayNotify(event: ServerMessage): boolean {
  switch (event.type) {
    case "run.done":
    case "run.error":
    case "run.cancelled":
    case "run.stalled":
      return true;
    case "tool.end":
      return Boolean(event.denied);
    default:
      return false;
  }
}

export async function notifyFromEvent(event: ServerMessage): Promise<void> {
  if (event.type === "run.start") {
    deniedThisRun = false;
    return;
  }
  /* Before any I/O: a stream is hundreds of deltas, and each one used to read config.yaml. */
  if (!mayNotify(event)) return;
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
