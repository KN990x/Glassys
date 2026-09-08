import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { MessageAttachment } from "@glassys/protocol";
import { paths } from "./paths.js";
import { HttpError } from "./errors.js";

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
