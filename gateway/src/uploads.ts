import { copyFile, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { MessageAttachment, TranscriptEvent } from "@glassys/protocol";
import type { PromptAttachment } from "@glassys/adapter-contract";
import { paths } from "./paths.js";
import { HttpError } from "./errors.js";
import { parseJsonl } from "./jsonl.js";

export const MAX_UPLOAD_BYTES = 4_000_000;
const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export interface StoredUpload {
  id: string;
  mime: string;
  name: string;
  path: string;
}

function metaPath(id: string): string {
  return `${paths.uploads()}/${id}.json`;
}

function dataPath(id: string): string {
  return `${paths.uploads()}/${id}`;
}

export function assertImageMime(mime: string): string {
  const normalized = mime === "image/jpg" ? "image/jpeg" : mime;
  if (!ALLOWED.has(normalized)) throw new HttpError(400, "Only jpeg, png, webp, and gif uploads are allowed");
  return normalized;
}

export async function saveUpload(body: Buffer, mime: string, name: string): Promise<MessageAttachment> {
  if (body.length > MAX_UPLOAD_BYTES) throw new HttpError(413, "payload too large");
  if (!body.length) throw new HttpError(400, "empty upload");
  const safeMime = assertImageMime(mime);
  const id = randomUUID();
  const base = name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80) || "image";
  await mkdir(paths.uploads(), { recursive: true });
  await writeFile(dataPath(id), body);
  await writeFile(metaPath(id), JSON.stringify({ id, mime: safeMime, name: base }), "utf8");
  return { id, mime: safeMime, name: base };
}

export async function loadUpload(id: string): Promise<StoredUpload | null> {
  if (!id || id.includes("/") || id.includes("..")) return null;
  try {
    const meta = JSON.parse(await readFile(metaPath(id), "utf8")) as { mime?: string; name?: string };
    const mime = typeof meta.mime === "string" ? meta.mime : "";
    const name = typeof meta.name === "string" ? meta.name : "image";
    if (!ALLOWED.has(mime)) return null;
    return { id, mime, name, path: dataPath(id) };
  } catch {
    return null;
  }
}

export async function readUploadBody(id: string): Promise<{ mime: string; name: string; body: Buffer } | null> {
  const stored = await loadUpload(id);
  if (!stored) return null;
  try {
    const body = await readFile(stored.path);
    return { mime: stored.mime, name: stored.name, body };
  } catch {
    return null;
  }
}

export async function resolveAttachments(
  attachments?: MessageAttachment[],
): Promise<Array<{ path: string; mime: string; name: string }>> {
  if (!attachments?.length) return [];
  const out: Array<{ path: string; mime: string; name: string }> = [];
  for (const item of attachments) {
    const stored = await loadUpload(item.id);
    if (stored) out.push({ path: stored.path, mime: stored.mime, name: stored.name });
  }
  return out;
}

const UPLOAD_DIR = ".glassys-uploads";

function safeUploadName(id: string, name: string): string {
  const base = name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80) || "image";
  return `${id.slice(0, 8)}-${base}`;
}

/** Copy uploads into `$cwd/.glassys-uploads` so sandboxed agents can read them. */
export async function materializeAttachments(
  cwd: string,
  attachments?: MessageAttachment[],
): Promise<PromptAttachment[]> {
  if (!attachments?.length) return [];
  const destDir = join(cwd, UPLOAD_DIR);
  await mkdir(destDir, { recursive: true });
  await writeFile(join(destDir, ".gitignore"), "*\n", "utf8").catch(() => undefined);
  const out: PromptAttachment[] = [];
  for (const item of attachments) {
    const file = await readUploadBody(item.id);
    if (!file) continue;
    const dest = join(destDir, safeUploadName(item.id, file.name));
    await copyFile(join(paths.uploads(), item.id), dest);
    out.push({ path: dest, mime: file.mime, name: file.name, body: file.body });
  }
  return out;
}

const UNREFERENCED_TTL_MS = 24 * 60 * 60 * 1000;

export async function gcUploads(now = Date.now()): Promise<void> {
  let files: string[] = [];
  try {
    files = await readdir(paths.uploads());
  } catch {
    return;
  }
  const referenced = new Set<string>();
  let threadIds: string[] = [];
  try {
    threadIds = await readdir(paths.threads());
  } catch {
    threadIds = [];
  }
  for (const tid of threadIds) {
    try {
      const events = parseJsonl<TranscriptEvent>(await readFile(paths.threadTranscript(tid), "utf8"));
      for (const ev of events) {
        if (ev.type !== "user.message" || !ev.attachments) continue;
        for (const att of ev.attachments) referenced.add(att.id);
      }
    } catch {
      /* skip unreadable thread */
    }
  }
  const seen = new Set<string>();
  for (const name of files) {
    const id = name.endsWith(".json") ? name.slice(0, -".json".length) : name;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (referenced.has(id)) continue;
    const data = dataPath(id);
    const meta = metaPath(id);
    let mtime = now;
    try {
      mtime = (await stat(data)).mtimeMs;
    } catch {
      try {
        mtime = (await stat(meta)).mtimeMs;
      } catch {
        continue;
      }
    }
    if (now - mtime < UNREFERENCED_TTL_MS) continue;
    await rm(data, { force: true });
    await rm(meta, { force: true });
  }
}
