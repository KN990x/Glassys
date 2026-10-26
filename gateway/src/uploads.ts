import { constants } from "node:fs";
import { copyFile, lstat, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { MessageAttachment, TranscriptEvent } from "@glassys/protocol";
import type { PromptAttachment } from "@glassys/adapter-contract";
import { log, paths, isSafeId } from "./paths.js";
import { HttpError } from "./errors.js";
import { loadConfig } from "./config.js";
import { loadState } from "./state.js";

export const MAX_UPLOAD_BYTES = 4_000_000;
const IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
const TEXT_MIME = new Set([
  "text/plain",
  "text/markdown",
  "text/x-log",
  "application/json",
  "application/x-ndjson",
]);
const TEXT_EXT = new Set([".log", ".txt", ".md", ".json", ".jsonl", ".service", ".conf", ".journal"]);

export function isImageMime(mime: string): boolean {
  const normalized = mime === "image/jpg" ? "image/jpeg" : mime;
  return IMAGE_MIME.has(normalized);
}

function extOf(name: string): string {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

export function normalizeUploadMime(mime: string, name: string): string {
  const raw = (mime || "").split(";")[0]?.trim().toLowerCase() || "";
  const normalized = raw === "image/jpg" ? "image/jpeg" : raw;
  if (IMAGE_MIME.has(normalized) || TEXT_MIME.has(normalized)) return normalized;
  if (normalized === "application/octet-stream" || normalized === "text/x-unknown" || !normalized) {
    const ext = extOf(name);
    if (TEXT_EXT.has(ext)) {
      if (ext === ".json") return "application/json";
      if (ext === ".jsonl") return "application/x-ndjson";
      if (ext === ".md") return "text/markdown";
      if (ext === ".log") return "text/x-log";
      return "text/plain";
    }
  }
  throw new HttpError(400, "Only jpeg, png, webp, gif, and text/log uploads are allowed");
}

function rejectBinaryText(body: Buffer, mime: string): void {
  if (isImageMime(mime)) return;
  const sample = body.subarray(0, 512);
  if (sample.includes(0)) throw new HttpError(400, "Only jpeg, png, webp, gif, and text/log uploads are allowed");
}

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

export async function saveUpload(body: Buffer, mime: string, name: string): Promise<MessageAttachment> {
  if (body.length > MAX_UPLOAD_BYTES) throw new HttpError(413, "payload too large");
  if (!body.length) throw new HttpError(400, "empty upload");
  const safeMime = normalizeUploadMime(mime, name);
  rejectBinaryText(body, safeMime);
  const id = randomUUID();
  const base = name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80) || (isImageMime(safeMime) ? "image" : "file");
  await mkdir(paths.uploads(), { recursive: true });
  await writeFile(dataPath(id), body, { mode: 0o600 });
  await writeFile(metaPath(id), JSON.stringify({ id, mime: safeMime, name: base }), { encoding: "utf8", mode: 0o600 });
  return { id, mime: safeMime, name: base };
}

export async function loadUpload(id: string): Promise<StoredUpload | null> {
  if (!isSafeId(id)) return null;
  try {
    const meta = JSON.parse(await readFile(metaPath(id), "utf8")) as { mime?: string; name?: string };
    const mime = typeof meta.mime === "string" ? meta.mime : "";
    const name = typeof meta.name === "string" ? meta.name : "file";
    try {
      normalizeUploadMime(mime, name);
    } catch {
      return null;
    }
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

const UPLOAD_DIR = ".glassys-uploads";

function safeUploadName(id: string, name: string): string {
  const base = name.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80) || "image";
  return `${id}-${base}`;
}

/** Names Glassys writes there: `<uuid>-<name>`, or the first 8 characters of the id in older copies. */
const COPY_NAME = /^[0-9a-f]{8}/;

function errCode(err: unknown): string | undefined {
  return (err as NodeJS.ErrnoException).code;
}

/**
 * `$cwd/.glassys-uploads` when it is a real directory, created if missing. The workspace is
 * the agent's (or a cloned repo's): a symlink there could point the copy, the .gitignore and the
 * clean-up at any directory the gateway can write.
 */
async function workspaceUploadDir(cwd: string, create: boolean): Promise<string | null> {
  const dir = join(cwd, UPLOAD_DIR);
  try {
    if ((await lstat(dir)).isDirectory()) return dir;
    if (!create) return null;
    throw new Error(`${dir} is not a directory; remove it so Glassys can copy attachments there`);
  } catch (err) {
    if (errCode(err) !== "ENOENT") throw err;
    if (!create) return null;
  }
  await mkdir(dir).catch((err) => {
    if (errCode(err) !== "EEXIST") throw err;
  });
  if (!(await lstat(dir)).isDirectory()) throw new Error(`${dir} is not a directory`);
  return dir;
}

/** Copy uploads into `$cwd/.glassys-uploads` so sandboxed agents can read them. */
export async function materializeAttachments(
  cwd: string,
  attachments?: MessageAttachment[],
): Promise<PromptAttachment[]> {
  if (!attachments?.length) return [];
  const destDir = (await workspaceUploadDir(cwd, true))!;
  /* "wx": never through a planted link, never over an operator's own file. */
  await writeFile(join(destDir, ".gitignore"), "*\n", { encoding: "utf8", flag: "wx" }).catch((err) => {
    if (errCode(err) === "EEXIST") return;
    log("warn", "could not write .glassys-uploads/.gitignore; copied images may show up in git", {
      cwd,
      error: String(err),
    });
  });
  const out: PromptAttachment[] = [];
  for (const item of attachments) {
    const file = await readUploadBody(item.id);
    if (!file) continue;
    const dest = join(destDir, safeUploadName(item.id, file.name));
    try {
      await copyFile(join(paths.uploads(), item.id), dest, constants.COPYFILE_EXCL);
    } catch (err) {
      /* The same upload sent again is already there; anything else in its place is not ours. */
      if (errCode(err) !== "EEXIST" || !(await lstat(dest)).isFile()) throw err;
    }
    out.push({ path: dest, mime: file.mime, name: file.name, body: file.body });
  }
  return out;
}

const UNREFERENCED_TTL_MS = 24 * 60 * 60 * 1000;

function collectAttachmentIds(raw: string, into: Set<string>): void {
  for (const line of raw.split("\n")) {
    if (!line.includes("user.message") || !line.includes("attachments")) continue;
    try {
      const ev = JSON.parse(line) as TranscriptEvent;
      if (ev.type !== "user.message" || !ev.attachments) continue;
      for (const att of ev.attachments) into.add(att.id);
    } catch {
      /* skip corrupt line */
    }
  }
}

/**
 * Attachment ids each transcript references, kept while the file is unchanged. GC runs on every
 * new thread, switch and delete; archived transcripts never change, so only the ones that grew
 * are read again instead of every transcript of every thread each time.
 */
const attachmentIndex = new Map<string, { size: number; mtimeMs: number; ids: Set<string> }>();

async function threadAttachmentIds(path: string): Promise<Set<string>> {
  const st = await stat(path);
  const cached = attachmentIndex.get(path);
  if (cached && cached.size === st.size && cached.mtimeMs === st.mtimeMs) return cached.ids;
  const ids = new Set<string>();
  collectAttachmentIds(await readFile(path, "utf8"), ids);
  attachmentIndex.set(path, { size: st.size, mtimeMs: st.mtimeMs, ids });
  return ids;
}

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
  const live = new Set<string>();
  for (const tid of threadIds) {
    const path = paths.threadTranscript(tid);
    live.add(path);
    try {
      for (const id of await threadAttachmentIds(path)) referenced.add(id);
    } catch {
      /* skip unreadable thread */
    }
  }
  for (const path of attachmentIndex.keys()) if (!live.has(path)) attachmentIndex.delete(path);
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
    try {
      await rm(data, { force: true });
      await rm(meta, { force: true });
    } catch (err) {
      log("warn", "could not remove an old upload", { id, error: String(err) });
    }
  }
  await gcCwdUploads(referenced, now);
}

async function gcCwdUploads(referenced: Set<string>, now: number): Promise<void> {
  /* Copies are `<id>-<name>`; older ones used the first 8 characters of the id. Matching on that prefix keeps both. */
  const prefixes = new Set([...referenced].map((id) => id.slice(0, 8)));
  const cwds = new Set<string>();
  try {
    const cfg = await loadConfig();
    if (cfg.agent.cwd) cwds.add(cfg.agent.cwd);
  } catch {
    /* ignore */
  }
  try {
    const state = await loadState();
    for (const cwd of state.recentCwds || []) if (cwd) cwds.add(cwd);
  } catch {
    /* ignore */
  }
  for (const cwd of cwds) {
    let names: string[] = [];
    let dir: string | null = null;
    try {
      dir = await workspaceUploadDir(cwd, false);
      if (dir) names = await readdir(dir);
    } catch {
      continue;
    }
    if (!dir) continue;
    for (const name of names) {
      /* Only copies Glassys made: regular files, named like one, never a link or a folder. */
      if (!COPY_NAME.test(name) || prefixes.has(name.slice(0, 8))) continue;
      const file = join(dir, name);
      try {
        const st = await lstat(file);
        if (!st.isFile() || now - st.mtimeMs < UNREFERENCED_TTL_MS) continue;
        await rm(file, { force: true });
      } catch (err) {
        log("warn", "could not remove an old attachment copy", { file, error: String(err) });
      }
    }
  }
}
